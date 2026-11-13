// The migration of skills recorded before the library (src/skillmigrate.ts, run by src/skillstore.ts openLibrary), on a home
// holding every state the earlier record (sync.json, format 1) could hold. After the migration and one pass, every tool's
// folder is byte for byte as it was, every content is a version, a second pass writes nothing, and a crash at each step of
// the migration leaves the earlier files as they were. Each state's target is the table in skillmigrate.ts's header.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdir, readFile, readdir, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { kindSource } from '../src/itemrow.ts';
import type { LibraryItem } from '../src/library.ts';
import { libraryWords, sentences } from '../src/libraryrow.ts';
import { pushRepo, connectRepo, pullRepo } from '../src/gitrepo.ts';
import { readTree, storeFolder, type ShareContext } from '../src/share.ts';
import { applySkills, skillsView } from '../src/skills.ts';
import { setDisabled, isDisabled, readSwitchFile } from '../src/skillswitch.ts';
import { readProfiles, switchProfile, saveProfile } from '../src/profiles.ts';
import { discover } from '../src/discovery.ts';
import type { HarnessId, HomeView } from '../src/types.ts';
import { bytes, folderOf, put, roots, sandbox, skillText, type Box, type Tool } from './skillclicks.ts';

const all: Tool[] = ['claude-cli', 'copilot-cli', 'codex-cli', 'opencode-cli'];
const text = (body: string, name: string) => skillText(body, name);
const hashOf = async (box: Box, tool: Tool, name: string) => (await readTree(folderOf(box, tool, name))).hash;

/** One skill on the earlier record, as it wrote it. */
interface OldSkill { name: string; hash: string; state: 'shared' | 'dont-share'; startId: string; observedAt: string; copies: { harness: HarnessId; directory: string; hash: string; created: boolean; status: 'written' | 'pending' | 'removing' }[];
  off?: HarnessId[]; separate?: boolean; use?: { tool: HarnessId; hash: string }; deleted?: { at: string; tool: HarnessId; hash: string }; keptOwn?: Partial<Record<HarnessId, string>>; displaced?: { tool: HarnessId; hash: string }[] }

/** A home with every state, written as the earlier engine left it; returns the record it wrote. */
async function oldHome() {
  const box = await sandbox(all);
  const items: Record<string, OldSkill> = {};
  const copy = async (tool: Tool, name: string, status: 'written' | 'pending' = 'written') => ({ harness: tool as HarnessId, directory: folderOf(box, tool, name), hash: await hashOf(box, tool, name), created: false, status });
  const keep = async (name: string, from: string) => {
    const tree = await readTree(from);
    const target = join(box.home, '.central-knot/items', storeFolder(name), tree.hash);
    await mkdir(join(target, '..'), { recursive: true });
    await cp(from, target, { recursive: true });
    return tree.hash;
  };
  const synced = async (name: string, tools: Tool[], extra: Partial<OldSkill> = {}) => {
    const hash = await hashOf(box, tools[0], name);
    await keep(name, folderOf(box, tools[0], name));
    items[name] = { name, hash, state: 'shared', startId: 's', observedAt: '2026-11-01T00:00:00.000Z', copies: await Promise.all(tools.map(tool => copy(tool, name))), ...extra };
  };
  // Synced in step everywhere, a folder of several files with modes and an empty folder.
  for (const tool of ['claude-cli', 'copilot-cli', 'codex-cli'] as Tool[]) await put(box, tool, { 'SKILL.md': text('In step.', 'steady'), 'run.sh': { text: '#!/bin/sh\n', mode: 0o755 }, 'own.txt': { text: 'x\n', mode: 0o600 } }, ['empty'], 'steady');
  await synced('steady', ['claude-cli', 'copilot-cli', 'codex-cli']);
  // Left out of Codex, which has a different copy of its own.
  for (const tool of ['claude-cli', 'copilot-cli'] as Tool[]) await put(box, tool, { 'SKILL.md': text('Synced.', 'leftout') }, [], 'leftout');
  await put(box, 'codex-cli', { 'SKILL.md': text('Codex’s own.', 'leftout') }, [], 'leftout');
  await synced('leftout', ['claude-cli', 'copilot-cli'], { off: ['codex-cli'] });
  // Left out of Codex, which has no copy: nothing goes there.
  for (const tool of ['claude-cli', 'copilot-cli'] as Tool[]) await put(box, tool, { 'SKILL.md': text('Synced.', 'leftbare') }, [], 'leftbare');
  await synced('leftbare', ['claude-cli', 'copilot-cli'], { off: ['codex-cli'] });
  // Copies kept different on purpose; and copies never synced (no record at all); and one turned off since it synced.
  await put(box, 'claude-cli', { 'SKILL.md': text('One.', 'apart') }, [], 'apart');
  await put(box, 'codex-cli', { 'SKILL.md': text('Two.', 'apart') }, [], 'apart');
  items.apart = { name: 'apart', hash: '', state: 'dont-share', startId: '', observedAt: '2026-11-01T00:00:00.000Z', copies: [], separate: true };
  await put(box, 'claude-cli', { 'SKILL.md': text('Mine.', 'unrecorded') }, [], 'unrecorded');
  await put(box, 'copilot-cli', { 'SKILL.md': text('Mine too.', 'unrecorded') }, [], 'unrecorded');
  await put(box, 'claude-cli', { 'SKILL.md': text('Was synced.', 'stopped') }, [], 'stopped');
  await put(box, 'codex-cli', { 'SKILL.md': text('Was synced.', 'stopped') }, [], 'stopped');
  items.stopped = { name: 'stopped', hash: await keep('stopped', folderOf(box, 'claude-cli', 'stopped')), state: 'dont-share', startId: 's', observedAt: '2026-11-01T00:00:00.000Z', copies: [] };
  // A copy an Undo of a choice left as its tool's own.
  for (const tool of ['claude-cli', 'copilot-cli'] as Tool[]) await put(box, tool, { 'SKILL.md': text('Chosen once.', 'ownkept') }, [], 'ownkept');
  await put(box, 'codex-cli', { 'SKILL.md': text('Codex kept its own.', 'ownkept') }, [], 'ownkept');
  await synced('ownkept', ['claude-cli', 'copilot-cli'], { keptOwn: { 'codex-cli': await hashOf(box, 'codex-cli', 'ownkept') } });
  // The Undo kept Codex's content in the store too, so it is a kept revision as well as Codex's own.
  await keep('ownkept', folderOf(box, 'codex-cli', 'ownkept'));
  // A choice not carried out yet: Claude Code's copy chosen; Copilot CLI has it; Codex has another it would have replaced.
  for (const tool of ['claude-cli', 'copilot-cli'] as Tool[]) await put(box, tool, { 'SKILL.md': text('Chosen.', 'choosing') }, [], 'choosing');
  await put(box, 'codex-cli', { 'SKILL.md': text('Not chosen.', 'choosing') }, [], 'choosing');
  items.choosing = { name: 'choosing', hash: '', state: 'shared', startId: 's', observedAt: '2026-11-01T00:00:00.000Z', copies: [], use: { tool: 'claude-cli', hash: await hashOf(box, 'claude-cli', 'choosing') } };
  // Content displaced before History named it: in the old store, so a version.
  for (const tool of ['claude-cli', 'copilot-cli', 'codex-cli'] as Tool[]) await put(box, tool, { 'SKILL.md': text('Now.', 'moved') }, [], 'moved');
  await synced('moved', ['claude-cli', 'copilot-cli', 'codex-cli']);
  const scratch = join(box.base, 'scratch/moved');
  await mkdir(scratch, { recursive: true });
  await writeFile(join(scratch, 'SKILL.md'), text('Displaced.', 'moved'));
  items.moved.displaced = [{ tool: 'codex-cli', hash: await keep('moved', scratch) }];
  // Deleted everywhere; one copy still owed a removal stays where it is.
  await mkdir(join(box.base, 'scratch/gone'), { recursive: true });
  await writeFile(join(box.base, 'scratch/gone/SKILL.md'), text('Deleted.', 'gone'));
  const goneHash = await keep('gone', join(box.base, 'scratch/gone'));
  await put(box, 'codex-cli', { 'SKILL.md': text('Deleted.', 'gone') }, [], 'gone');
  items.gone = { name: 'gone', hash: goneHash, state: 'dont-share', startId: 's', observedAt: '2026-11-01T00:00:00.000Z', copies: [await copy('codex-cli', 'gone')].map(entry => ({ ...entry, status: 'removing' as const })), deleted: { at: new Date().toISOString(), tool: 'claude-cli', hash: goneHash } };
  // Disabled in Codex only, and disabled in every tool, by each tool's own switch (as Central Knot or a person set it).
  for (const name of ['quiet', 'silent']) for (const tool of ['claude-cli', 'copilot-cli', 'codex-cli'] as Tool[]) await put(box, tool, { 'SKILL.md': text('Hushed.', name) }, [], name);
  await synced('quiet', ['claude-cli', 'copilot-cli', 'codex-cli']);
  await synced('silent', ['claude-cli', 'copilot-cli', 'codex-cli']);
  const target = (tool: Tool, name: string) => ({ folder: name, name, skillFile: join(folderOf(box, tool, name), 'SKILL.md') });
  await setDisabled(box.context, 'codex-cli', target('codex-cli', 'quiet'), true);
  for (const tool of ['claude-cli', 'copilot-cli', 'codex-cli'] as Tool[]) await setDisabled(box.context, tool, target(tool, 'silent'), true);
  // OpenCode reads Claude Code's folder: it had no copy of its own (read), or one the earlier engine adopted (both).
  for (const tool of ['claude-cli', 'copilot-cli', 'codex-cli'] as Tool[]) await put(box, tool, { 'SKILL.md': text('Read.', 'read') }, [], 'read');
  await synced('read', ['claude-cli', 'copilot-cli', 'codex-cli']);
  for (const tool of all) await put(box, tool, { 'SKILL.md': text('Twice.', 'both') }, [], 'both');
  await synced('both', all);
  // A copy in ~/.agents/skills that Codex and Copilot CLI read (Codex synced there), and Claude Code's own.
  await put(box, 'claude-cli', { 'SKILL.md': text('Shared.', 'common') }, [], 'common');
  await mkdir(join(box.home, '.agents/skills/common'), { recursive: true });
  await writeFile(join(box.home, '.agents/skills/common/SKILL.md'), text('Shared.', 'common'));
  await synced('common', ['claude-cli']);
  items.common.copies.push({ harness: 'codex-cli', directory: join(box.home, '.agents/skills/common'), hash: items.common.hash, created: false, status: 'written' });
  // A link in Copilot CLI's folder to a folder of the person's.
  await mkdir(join(box.home, 'mine/linked'), { recursive: true });
  await writeFile(join(box.home, 'mine/linked/SKILL.md'), text('Linked.', 'linked'));
  for (const tool of ['claude-cli', 'codex-cli'] as Tool[]) await put(box, tool, { 'SKILL.md': text('Linked.', 'linked') }, [], 'linked');
  await symlink(join(box.home, 'mine/linked'), folderOf(box, 'copilot-cli', 'linked'));
  await synced('linked', ['claude-cli', 'codex-cli']);
  // A profile holds a switch off in Codex for one skill.
  await setDisabled(box.context, 'codex-cli', target('codex-cli', 'steady'), true);
  await mkdir(join(box.home, '.central-knot'), { recursive: true });
  await writeFile(join(box.home, '.central-knot/profiles.json'), `${JSON.stringify({ formatVersion: 1, profiles: [{ id: 'p', name: 'Work', items: ['skill:leftout'] }], active: 'p', offByProfile: { 'skill:steady': ['codex-cli'] } }, null, 2)}\n`);
  const roots0 = Object.fromEntries(await Promise.all(all.map(async tool => { const info = await stat(join(box.home, roots[tool])); return [join(box.home, roots[tool]), { ino: info.ino, birth: Math.round(info.birthtimeMs) }] as const; })));
  const record = { formatVersion: 1, generation: 'g1', owner: 'test', items, roots: roots0, tools: all };
  await writeFile(join(box.home, '.central-knot/sync.json'), `${JSON.stringify(record, null, 2)}\n`);
  await writeFile(box.context.settingsPath, JSON.stringify({ homes: { [box.home]: { generation: 'g1' } } }));
  box.tools.splice(0, box.tools.length, ...all);
  return { box, record };
}

/** Every file a tool or the person has, and every switch file, byte for byte: what the migration and a pass must leave as they were. */
async function folders(box: Box) {
  const found: Record<string, unknown> = {};
  for (const tool of all) found[tool] = await bytes(join(box.home, roots[tool]));
  for (const extra of ['.agents', 'mine', '.codex/config.toml', '.claude/settings.json', '.copilot/settings.json', '.config/opencode/opencode.json', '.central-knot/profiles.json']) found[extra] = await bytes(join(box.home, extra)).catch(() => undefined) ?? await readFile(join(box.home, extra), 'utf8').catch(() => undefined);
  return found;
}
const pass = (box: Box, context: ShareContext = box.context) => applySkills(context, box.tools, []);
const library = async (box: Box) => (await skillsView(box.context, box.tools)).library;

test('Migration: every state lands where its table says, every folder byte for byte as it was after one pass, and a second pass writes nothing', async () => {
  const { box, record } = await oldHome();
  try {
    const before = await folders(box);
    const first = await pass(box);
    assert.equal(first.stopped, undefined);
    assert.deepEqual(first.results.filter(result => result.outcome !== 'held'), [], 'one pass writes and removes nothing');
    assert.deepEqual(await folders(box), before);
    assert.equal((await pass(box)).writes, 0);
    const items = await library(box);
    const where = (key: string) => { const item = items[key]; return item && { on: item.on, deleted: !!item.deleted, except: [...item.except].sort(), applied: Object.keys(item.applied).sort() }; };
    assert.deepEqual(where('steady'), { on: true, deleted: false, except: [], applied: ['claude-cli', 'codex-cli', 'copilot-cli'] });
    assert.deepEqual(where('leftout'), { on: true, deleted: false, except: ['codex-cli'], applied: ['claude-cli', 'copilot-cli'] });
    assert.deepEqual(where('leftbare'), { on: true, deleted: false, except: ['codex-cli'], applied: ['claude-cli', 'copilot-cli'] });
    assert.deepEqual([where('apart'), where('unrecorded'), where('stopped')], [undefined, undefined, undefined], 'not in the library: found');
    assert.deepEqual(where('ownkept'), { on: true, deleted: false, except: ['codex-cli'], applied: ['claude-cli', 'copilot-cli'] });
    assert.deepEqual(where('choosing'), { on: true, deleted: false, except: ['codex-cli'], applied: ['claude-cli', 'copilot-cli'] });
    assert.equal(items.choosing.hash, record.items.choosing.use!.hash, 'the choice made is the current version');
    assert.deepEqual(where('gone'), { on: true, deleted: true, except: [], applied: [] });
    assert.deepEqual(where('read'), { on: true, deleted: false, except: [], applied: ['claude-cli', 'codex-cli', 'copilot-cli'] }, 'OpenCode reads Claude Code’s copy');
    assert.deepEqual(where('both'), { on: true, deleted: false, except: [], applied: ['claude-cli', 'codex-cli', 'copilot-cli'] }, 'OpenCode’s own copy is left alone: it has it both ways');
    assert.deepEqual(where('common'), { on: true, deleted: false, except: [], applied: ['claude-cli'] }, 'Codex and Copilot CLI read ~/.agents/skills');
    assert.deepEqual(where('linked'), { on: true, deleted: false, except: [], applied: ['claude-cli', 'codex-cli'] }, 'Copilot CLI has it through a link');
    // Every content: each revision kept before, and each copy any tool holds of a skill in the library, is a version of it.
    for (const [key, item] of Object.entries(items) as [string, LibraryItem][]) {
      const versions = new Set(item.versions.map(version => version.hash));
      for (const hash of await readdir(join(box.home, '.central-knot/items', storeFolder(key))).catch(() => [] as string[])) if (/^[0-9a-f]{64}$/.test(hash)) assert.ok(versions.has(hash), `${key}: kept revision ${hash}`);
      for (const tool of all) { const there = await readTree(folderOf(box, tool, key)).catch(() => undefined); if (there && !item.deleted) assert.ok(versions.has(there.hash), `${key}: ${tool}’s copy`); }
      for (const version of item.versions) assert.ok(await stat(join(box.home, '.central-knot/items/skills', storeFolder(key), 'versions', version.hash)).then(() => true, () => false), `${key}: ${version.hash} is stored`);
    }
    // The records: skills.json is the library's, sync.json keeps who syncs this home and its tools, sync.v1.json the earlier file.
    const sync = JSON.parse(await readFile(join(box.home, '.central-knot/sync.json'), 'utf8'));
    assert.deepEqual(sync, { formatVersion: 2, generation: 'g1', owner: 'test', tools: all });
    assert.deepEqual(JSON.parse(await readFile(join(box.home, '.central-knot/sync.v1.json'), 'utf8')), record);
  } finally { await box.cleanup(); }
});

test('Migration: a switch set before is left as it is: Codex still doesn’t load the skill, and one switched off in every tool never reads plainly on', async () => {
  const { box } = await oldHome();
  try {
    await pass(box);
    const quiet = { folder: 'quiet', name: 'quiet', skillFile: join(folderOf(box, 'codex-cli', 'quiet'), 'SKILL.md') };
    assert.equal(isDisabled(box.context, await readSwitchFile(box.context, 'codex-cli'), quiet), true);
    const view = await skillsView(box.context, box.tools);
    const home = { skills: view, mcp: { tools: [], items: [], library: {} }, agents: view, profiles: { profiles: [{ id: 'p', name: 'Work', items: [] }], active: 'p', offByProfile: { 'skill:steady': ['codex-cli'] } } } as unknown as HomeView;
    const facts = kindSource(home, 'skills').facts;
    const say = sentences(libraryWords.skills), tools = all;
    const tag = (key: string) => { const fact = facts.find(entry => entry.key === key)!; return say.placeTag({ key, hashes: {}, switched: fact.switched, cannot: fact.cannot }, view.library[key], tools)?.text; };
    assert.equal(tag('quiet'), 'switched off in Codex');
    assert.match(tag('silent') ?? '', /^switched off in (all 3 tools|Claude Code, Copilot CLI and Codex)/);
    // A profile's hold is said with the profile's name.
    assert.deepEqual(facts.find(entry => entry.key === 'steady')!.switched, { 'codex-cli': 'switched off in Codex by the profile Work' });
  } finally { await box.cleanup(); }
});

test('Migration: a crash at each of its steps leaves the earlier record and kept revisions as they were, and the next pass migrates', async () => {
  for (const step of ['before-replace', 'mid-replace', 'after-rename'] as const) {
    const { box, record } = await oldHome();
    try {
      const store = join(box.home, '.central-knot/items');
      const kept = await bytes(store);
      const crash: ShareContext = { ...box.context, fault: at => { if (at === step) throw new Error(`crash at ${step}`); } };
      await pass(box, crash).catch(() => undefined);
      const sync = JSON.parse(await readFile(join(box.home, '.central-knot/sync.json'), 'utf8'));
      if (step !== 'after-rename') assert.deepEqual(sync, record, `${step}: sync.json as it was`);
      for (const [path, entry] of Object.entries(kept!)) if (!path.startsWith('skills/')) assert.equal((await bytes(store))![path], entry, `${step}: ${path}`);
      const before = await folders(box);
      await pass(box);
      assert.deepEqual(await folders(box), before, step);
      assert.equal(JSON.parse(await readFile(join(box.home, '.central-knot/sync.json'), 'utf8')).formatVersion, 2, step);
      assert.equal((await library(box)).steady.on, true, step);
    } finally { await box.cleanup(); }
  }
});

test('Migration: a reader before anything is written sees the migrated skills and their versions, and writes nothing', async () => {
  const { box, record } = await oldHome();
  try {
    const items = await library(box);
    assert.equal(items.steady.on, true);
    assert.equal(await stat(join(box.home, '.central-knot/skills.json')).then(() => true, () => false), false);
    assert.deepEqual(JSON.parse(await readFile(join(box.home, '.central-knot/sync.json'), 'utf8')), record);
  } finally { await box.cleanup(); }
});

test('A profile that leaves out a found skill and an Off one, then No profile: the hold on the Off one is dropped, and turned on its switch shows', async () => {
  const { box } = await oldHome();
  try {
    await pass(box);
    // leftout is On, steady is turned Off; "apart" is found. A profile with neither leaves them out.
    const reading: ShareContext = { ...box.context, read: () => Promise.all(all.map(harness => discover({ home: box.home, mode: 'custom', harness }))) };
    await applySkills(reading, box.tools, [{ key: 'steady', managed: false, off: [] }]);
    const only = (await saveProfile(reading, { name: 'Only leftout', items: ['skill:leftout'] })).id!;
    const switched = await switchProfile(reading, only);
    assert.equal(switched.stopped, undefined);
    assert.ok(switched.flips.some(flip => flip.item === 'skill:apart'), 'a found skill is left out too');
    assert.ok(!switched.flips.some(flip => flip.item === 'skill:steady'), 'an Off skill is in no tool: nothing to switch');
    await switchProfile(reading, null);
    assert.equal((await readProfiles(box.home)).offByProfile['skill:steady'], undefined, 'No profile drops the hold, as no folder is there');
    await applySkills(reading, box.tools, [{ key: 'steady', managed: true, off: [] }]);
    const view = await skillsView(reading, box.tools);
    const steady = view.items.find(entry => entry.key === 'steady')!;
    assert.ok(Object.values(steady.loads ?? {}).some(at => at?.off), 'a switch still set shows its mark: the row does not read as plain on');
  } finally { await box.cleanup(); }
});

test('Push then Pull of a skill with an empty folder and a file of mode 0600 makes no new version', async () => {
  const { box } = await oldHome();
  try {
    await pass(box);
    const remote = join(box.base, 'remote.git');
    (await import('node:child_process')).execFileSync('git', ['init', '--quiet', '--bare', '--initial-branch=main', remote]);
    const context = { ...box.context, read: async () => [] };
    await connectRepo(context, remote, '');
    assert.equal((await pushRepo(context)).stopped, undefined);
    const versions = (await library(box)).steady.versions.length;
    const pulled = await pullRepo(context);
    assert.equal(pulled.stopped, undefined);
    assert.equal(pulled.pulled, 0, 'nothing to pull');
    assert.equal((await library(box)).steady.versions.length, versions);
  } finally { await box.cleanup(); }
});

