// Upgrading a whole home an older version made, as a person meets it. The homes in tests/upgrade/ were made by the old
// versions' own engines (tests/upgrade/README.md says how); each is copied to a temp home and opened by this version, each
// start in a process of its own (tests/upgrade/start.ts runs what main.ts runs: homepass.ts homePass, then the pages' reads).
//   preview-9  made by v0.5.0-preview.9: nothing is on the library, so all four one-time migrations run in one start
//              (profilemigrate.ts first; skillmigrate.ts, servermigrate.ts and agentmigrate.ts as each library opens)
//   alpha-1    preview-9 opened once by v0.6.0-alpha.1 with Automatic sync on: skills and agents are on the library already,
//              MCP servers and profiles are not; then one more hand edit, made with Automatic sync off
// Each has Claude Code, Copilot CLI and Codex, and in them: the skill notes, synced everywhere, with an edit's History entry
// whose Undo brings back its earlier content and a hand edit waiting in one tool; style, synced but kept out of Codex, which
// keeps its own; clash, whose copies differ, turned on with no copy chosen (never synced); drafts, in Claude Code alone;
// scratch, found in Codex; the MCP servers docs (synced everywhere, Claude Code too), search (in Claude Code alone) and
// local-db (found in Codex); the agents reviewer (synced), planner (one-way from Claude Code) and helper (found in Copilot
// CLI); and the profile Focus, in use, which holds drafts and search off in Claude Code.
//
// Upgrading changes in the tools' own files only what the migrations' headers promise. Today that is profilemigrate.ts's:
// the switches format 1 lists are released, and an item they held off in every tool that has it is turned Off, its copies
// then taken out by a pass. With Automatic sync on, the first pass also takes in the waiting edit (skillmigrate.ts: "an edit
// not spread yet ... the first pass takes the edit in"; in alpha-1, where skills are on the library already, the ordinary
// rule does the same).
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cp, mkdir, mkdtemp, readdir, readFile, realpath, rm, stat, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { isAbsolute, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { agentsFolder } from '../src/agentfiles.ts';
import { observe, seenBefore } from '../src/arrivals.ts';
import { readHistory } from '../src/history.ts';
import { agentKind, applyAgents } from '../src/agents.ts';
import { chooseTools } from '../src/toolchoice.ts';
import { libraryEntry } from '../src/historyactions.ts';
import { itemKey, type ItemKind, type LibraryItem } from '../src/library.ts';
import { homeItems, inUse, switchPlan } from '../src/profileplan.ts';
import { homePass } from '../src/homepass.ts';
import { toolMark } from '../src/pluginstatus.ts';
import { readProfiles } from '../src/profiles.ts';
import { readTool, serverHash } from '../src/mcp.ts';
import { bringForward, type PluginEntry } from '../src/pluginrecord.ts';
import { applyServers, serverKind, serversView } from '../src/servers.ts';
import { setSyncEverything } from '../src/everything.ts';
import { libraryGate, managedNow, readRecord, syncGate, writeAccess } from '../src/share.ts';
import { asksNow } from '../src/setupcounts.ts';
import { applySkills, skillKind } from '../src/skills.ts';
import type { HarnessId, HistoryEvent, HomeView } from '../src/types.ts';
import type { AgentTool } from '../src/presence.ts';
import { appContext, filesIn, type AfterPass, type Files } from './upgrade/start.ts';
import { createMarketplaces, type MarketplaceEngine, type MarketplaceHost } from '../src/marketplaces.ts';
import * as plugins_ from '../src/plugins.ts';
import { autoUpdates } from '../src/pluginupdates.ts';

const fixtures = fileURLToPath(new URL('upgrade/', import.meta.url));
/** Where tests/upgrade/make.mjs made the homes: their records name the home's files by paths under it. */
const MADE_AT = '/tmp/ck-upgrade-fixture/home';

/** An old home, and the hand edit waiting in it: the file it is in, and the same skill's file in the other two tools. */
interface OldHome { folder: 'preview-9' | 'alpha-1'; waiting: { tool: HarnessId; file: string }; others: string[] }
const NOTES = { claude: '.claude/skills/notes/SKILL.md', copilot: '.copilot/skills/notes/SKILL.md', codex: '.codex/skills/notes/SKILL.md' };
const homes: OldHome[] = [
  { folder: 'preview-9', waiting: { tool: 'copilot-cli', file: NOTES.copilot }, others: [NOTES.claude, NOTES.codex] },
  { folder: 'alpha-1', waiting: { tool: 'codex-cli', file: NOTES.codex }, others: [NOTES.claude, NOTES.copilot] },
];

/** What the profiles migration does to the tools' files in these homes: each file it changes, with its text after (none: gone). */
const profilesMigration: Record<string, string | undefined> = {
  // drafts's switch and search's deny are released (Claude Code's skillOverrides and deniedMcpServers go with their last entry).
  '.claude/settings.json': '{}\n',
  // search was held off in Claude Code, the one tool that has it: it is Off, and its entry is taken out (a version keeps it).
  '.claude.json': '{\n  "numStartups": 3,\n  "mcpServers": {\n    "docs": {\n      "type": "stdio",\n      "command": "npx",\n      "args": [\n        "-y",\n        "docs-mcp"\n      ]\n    }\n  }\n}\n',
  // drafts was held off in Claude Code, the one tool that has it: it is Off, and its copy is taken out (a version keeps it).
  '.claude/skills/drafts/SKILL.md': undefined,
};
/** The items Focus held off in every tool that has them, which the profiles migration turns Off. */
const heldOff = ['skill:drafts', 'mcp:search'];
/** The items the old home never synced (clash was turned on, but no copy was ever chosen): found before, and found after. */
const neverSynced = ['skill:clash', 'skill:scratch', 'mcp:local-db', 'agent:helper'];

const sha256 = (text: string) => createHash('sha256').update(text).digest('hex');
const inTools = (path: string) => !path.startsWith('.central-knot/');
/** The tools' files (every file outside .central-knot) whose bytes differ between two reads of the home, or that came or went. */
const changedInTools = (from: Files, to: Files) =>
  [...new Set([...Object.keys(from.sha256), ...Object.keys(to.sha256)])].filter(path => inTools(path) && from.sha256[path] !== to.sha256[path]).sort();
/** Every file written between two reads of the home, with the same bytes or not, or that came or went. */
const writtenBetween = (from: Files, to: Files) =>
  [...new Set([...Object.keys(from.stamp), ...Object.keys(to.stamp)])].filter(path => from.stamp[path] !== to.stamp[path]).sort();

interface Box { base: string; home: string; appData: string; store: string }

/**
 * An old home copied to a temp home as if it had always been there, as it is for a person who upgrades in place: each path it
 * was made with names the copy; each folder identity its records keep (inode and birth time, which tell a folder made again
 * from the one there before) is the copy's folder's own; and the app remembers the home's sync record, in its own data.
 */
async function place(folder: OldHome['folder'] | 'alpha-1-parts'): Promise<Box> {
  const base = await realpath(await mkdtemp(join(tmpdir(), 'ck-upgrade-')));
  const home = join(base, 'home'), appData = join(base, 'app'), store = join(home, '.central-knot');
  await cp(join(fixtures, folder), home, { recursive: true });
  for (const path of Object.keys((await filesIn(home)).sha256)) {
    const text = await readFile(join(home, path), 'utf8');
    if (text.includes(MADE_AT)) await writeFile(join(home, path), text.replaceAll(MADE_AT, home));
  }
  const context = appContext(home, appData);
  const seen = async (path: string) => { const info = await stat(path); return { ino: info.ino, birth: Math.round(info.birthtimeMs) }; };
  // Format 1's skills record keys them by path (`roots`), format 2's agents record by tool (`roots`), a library's record by
  // tool with the path (`folders`; a settings file's has inode 0, and is left as it is).
  for (const name of ['sync.json', 'skills.json', 'agents.json']) {
    const record = JSON.parse(await readFile(join(store, name), 'utf8').catch(() => 'null'));
    if (!record?.roots && !record?.folders) continue;
    for (const [at, was] of Object.entries<object>(record.roots ?? {})) Object.assign(was, await seen(isAbsolute(at) ? at : agentsFolder(context, at as AgentTool)));
    for (const was of Object.values<{ path: string; ino?: number }>(record.folders ?? {})) if (was.ino) Object.assign(was, await seen(was.path));
    await writeFile(join(store, name), `${JSON.stringify(record, null, 2)}\n`);
  }
  const { generation } = JSON.parse(await readFile(join(store, 'sync.json'), 'utf8'));
  await mkdir(appData);
  await writeFile(context.settingsPath, `${JSON.stringify({ homes: { [home]: { generation } } }, null, 2)}\n`);
  return { base, home, appData, store };
}

/** One start of this version on the home, in a process of its own: what each of its `passes` left (tests/upgrade/start.ts). */
const start = (box: Box, sync: 'on' | 'off', passes: number): AfterPass[] => JSON.parse(execFileSync(process.execPath,
  [join(fixtures, 'start.ts'), box.home, box.appData, sync, String(passes)], { encoding: 'utf8', maxBuffer: 256 << 20 }));

const pageOf = { skill: 'skills', mcp: 'mcp', agent: 'agents' } as const;
const libraryOf = (pass: AfterPass, kind: ItemKind): Record<string, LibraryItem> => pass.pages[pageOf[kind]].library;
const readJson = async (path: string) => JSON.parse(await readFile(path, 'utf8').catch(() => 'null'));

/**
 * An item as a kind's record keeps it, the fields read here: on the library, On or Off, maybe deleted, where it is applied and
 * the tools it is kept out of; before it, shared or not, its copies (`harness` in the skills record, `tool` in the others;
 * `status` in some) and the tools it was left out of.
 */
interface RecordedItem {
  hash: string; on?: boolean; deleted?: unknown; applied?: Partial<Record<HarnessId, string>>; except?: HarnessId[];
  state?: string; copies?: { tool?: HarnessId; harness?: HarnessId; status?: string }[]; off?: HarnessId[];
}

/**
 * Each item the old home synced, from the record each kind kept there: before the library, one shared at a content, with the
 * tools it had a copy written in (`tools`) and those it was left out of (`out`); on the library, one On (not deleted), with the
 * tools it is applied in and those it is kept out of.
 */
async function syncedBefore(store: string): Promise<{ id: string; kind: ItemKind; key: string; hash: string; tools: HarnessId[]; out: HarnessId[] }[]> {
  const records: [ItemKind, { items?: Record<string, RecordedItem> } | null][] = [
    ['skill', (await readJson(join(store, 'skills.json'))) ?? (await readJson(join(store, 'sync.json')))],
    ['mcp', await readJson(join(store, 'mcp.json'))], ['agent', await readJson(join(store, 'agents.json'))]];
  return records.flatMap(([kind, record]) => Object.entries(record?.items ?? {}).flatMap(([name, item]) => {
    const onLibrary = item.on !== undefined;
    if (onLibrary ? !item.on || item.deleted : item.state !== 'shared' || !item.hash) return [];
    const written = (item.copies ?? []).filter(copy => !copy.status || copy.status === 'written').map(copy => (copy.tool ?? copy.harness)!);
    const tools = onLibrary ? Object.keys(item.applied ?? {}) as HarnessId[] : written;
    return [{ id: `${kind}:${itemKey(name)}`, kind, key: itemKey(name), hash: item.hash, tools, out: (onLibrary ? item.except : item.off) ?? [] }];
  }));
}

/**
 * Where an old store kept a content, by the path under it: each kind's folder before the library, and the library's versions
 * (a skill's folder before the library is named by share.ts storeFolder, which is the skill's key for every skill here).
 */
const KEPT: [ItemKind, RegExp][] = [
  ['agent', /^items\/agents\/([^/]+)\/(?:versions\/)?([0-9a-f]{64})(?:\.json|\/agent\.json)$/],
  ['mcp', /^items\/mcp\/([^/]+)\/(?:versions\/)?([0-9a-f]{64})\.json$/],
  ['skill', /^items\/skills\/([^/]+)\/versions\/([0-9a-f]{64})\//],
  ['skill', /^items\/(?!agents\/|mcp\/|skills\/)([^/]+)\/([0-9a-f]{64})\//],
];

/**
 * Every content the old home could still bring back: each one its store kept, and each one its History entries name (the
 * content before a change, the one that won, and those that gave way; an agent's losers name whole files, kept as its own
 * parts, not contents).
 */
async function restorableBefore(store: string): Promise<{ kind: ItemKind; key: string; hash: string; from: string }[]> {
  const found = Object.keys((await filesIn(store)).sha256).flatMap(path => KEPT.flatMap(([kind, pattern]) => {
    const match = pattern.exec(path);
    return match ? [{ kind, key: itemKey(decodeURIComponent(match[1])), hash: match[2], from: `kept as ${path}` }] : [];
  }));
  const kinds = { skills: 'skill', mcp: 'mcp', agents: 'agent' } as const;
  for (const event of ((await readJson(join(store, 'history.json')))?.events ?? []) as HistoryEvent[]) {
    const whose = libraryEntry(event);
    if (!whose) continue;
    const named = [event.previous, event.winner?.hash, ...(whose.kind === 'agents' ? [] : event.losers.map(loser => loser.hash))];
    for (const hash of new Set(named.filter((one): one is string => !!one))) found.push({ kind: kinds[whose.kind], key: whose.key, hash, from: `History's ${event.kind} entry` });
  }
  return found;
}

for (const old of homes) for (const sync of ['off', 'on'] as const) {
  describe(`Upgrading ${old.folder} with Automatic sync ${sync}`, () => {
    let box: Box, made: Files, first: AfterPass[], again: AfterPass[];
    before(async () => {
      box = await place(old.folder);
      made = await filesIn(box.home);
      first = start(box, sync, 3);
      again = start(box, sync, 1);
    });
    after(() => rm(box.base, { recursive: true, force: true }));

    test(`changes in the tools only what the migrations promise${sync === 'on' ? ', and takes in the waiting edit' : ''}, and nothing fails`, () => {
      // With Sync on, the waiting edit is the skill's content everywhere: the other two tools' copies are made the same.
      const takenIn = Object.fromEntries(sync === 'on' ? old.others.map(path => [path, made.sha256[old.waiting.file]]) : []);
      const expected = { ...Object.fromEntries(Object.entries(profilesMigration).map(([path, text]) => [path, text === undefined ? undefined : sha256(text)])), ...takenIn };
      assert.deepEqual(changedInTools(made, first[0].files), Object.keys(expected).sort(), 'the tools\' files that changed, and no others');
      for (const [path, hash] of Object.entries(expected)) assert.equal(first[0].files.sha256[path], hash, path);
      assert.deepEqual([...first, ...again].flatMap(pass => pass.problems), []);
    });

    test('keeps every synced item On at the content it had, in every tool it was in and out of those it was not, but those Focus held off', async () => {
      const pass = first[0];
      const waitingNow = pass.pages.skills.items.find(row => row.key === 'notes')!.copies[old.waiting.tool]!.hash;
      for (const was of await syncedBefore(join(fixtures, old.folder, '.central-knot'))) {
        const item = libraryOf(pass, was.kind)[was.key], row = pass.pages[pageOf[was.kind]].items.find(each => each.key === was.key);
        assert.ok(item && !item.deleted && row, `${was.id} is in the library`);
        assert.equal(item.on, !heldOff.includes(was.id), `${was.id} is ${heldOff.includes(was.id) ? 'Off' : 'On'}`);
        // With Sync on, the first pass took the waiting edit in: notes is at it. search was recorded with an empty argument
        // list, which is read as none now (mcp.ts nonEmpty): the first pass takes it in once at that hash, its files as they were.
        const had = was.id === 'skill:notes' && sync === 'on' ? waitingNow : was.id === 'mcp:search' ? serverHash({ transport: 'stdio', command: 'search-mcp' }) : was.hash;
        assert.equal(item.hash, had, `${was.id} is at the content it had`);
        assert.ok(item.versions.some(version => version.hash === item.hash), `${was.id}'s content is one of its versions`);
        for (const tool of was.out) assert.ok(item.except.includes(tool), `${was.id} is still kept out of ${tool}`);
        if (heldOff.includes(was.id)) continue;
        for (const tool of was.tools) assert.ok(item.applied[tool] !== undefined && row.copies[tool], `${was.id} is still in ${tool}`);
      }
      for (const id of neverSynced) {
        const [kind, key] = id.split(':') as [ItemKind, string];
        assert.ok(!libraryOf(pass, kind)[key] && pass.pages[pageOf[kind]].items.some(row => row.key === key), `${id}, never synced, is found`);
      }
    });

    test('keeps every content the old records and History could bring back as a version of its item, and can read each', async () => {
      for (const { kind, key, hash, from } of await restorableBefore(join(fixtures, old.folder, '.central-knot'))) {
        assert.ok(libraryOf(first[0], kind)[key]?.versions.some(version => version.hash === hash), `${kind} ${key}'s content ${hash.slice(0, 12)} (${from}) is a version`);
      }
      assert.deepEqual([...first, ...again].flatMap(pass => pass.unreadable), [], 'versions the pages list that cannot be read');
    });

    if (sync === 'off') test('copies the hand edit waiting in one tool nowhere, leaves it on disk, and shows it waiting', () => {
      for (const path of [old.waiting.file, ...old.others]) for (const pass of [...first, ...again]) assert.equal(pass.files.sha256[path], made.sha256[path], path);
      assert.notEqual(made.sha256[old.waiting.file], made.sha256[old.others[0]], 'the edit differs from the synced copies');
      assert.deepEqual(first[0].pages.skills.items.find(row => row.key === 'notes')!.edited, [old.waiting.tool]);
    });

    test('writes no file, and adds no History entry, in a second and a third pass', () => {
      assert.deepEqual(writtenBetween(first[0].files, first[1].files), [], 'the second pass');
      assert.deepEqual(writtenBetween(first[1].files, first[2].files), [], 'the third pass');
    });

    test('changes nothing when started a second time, with the migrations run again', () => {
      assert.deepEqual(writtenBetween(first[2].files, again[0].files), []);
      for (const kind of ['skill', 'mcp', 'agent'] as const) assert.deepEqual(libraryOf(again[0], kind), libraryOf(first[2], kind), `the ${kind} library as the pages read it`);
    });

    test('keeps Focus the profile in use', async () => {
      const profiles = await readProfiles(box.home);
      assert.deepEqual(inUse(profiles.profiles, homeItems({ ...first[0].pages, profiles }), []).map(profile => profile.name), ['Focus']);
    });

    // First setup's question, after the passes above (it changes the home's record, so these two come last): asked at each start
    // until it is answered, never again after, and No changes no file in the tools.
    test('is asked the question once: at every start until it is answered; No changes no file and adds no History entry, and it is not asked again', async () => {
      const context = appContext(box.home, box.appData), managed = await managedNow(context, await context.read());
      const asked = async (pages: AfterPass['pages']) => asksNow({ ...pages, sync: { syncEverything: (await readRecord(box.home)).record?.syncEverything, managed, access: await writeAccess(context), gate: await syncGate(context) } } as unknown as HomeView);
      assert.deepEqual([await asked(first[0].pages), await asked(again[0].pages)], ['question', 'question']);
      const history = await readJson(join(box.store, 'history.json'));
      assert.deepEqual(await setSyncEverything(context, false, true), {});
      const answered = start(box, sync, 2);
      assert.deepEqual([changedInTools(again[0].files, answered[1].files), await readJson(join(box.store, 'history.json'))], [[], history]);
      assert.equal(await asked(answered[1].pages), undefined);
    });

    // One click past the upgrade, last since it changes the home: Off takes each copy out, and On writes it back from the
    // item's version and each tool's own part (a server's own fields, an agent's whole file), as the migrations carried them.
    if (sync === 'on') test('gives every tool its file back byte for byte when notes, docs and planner are turned Off and On again', async () => {
      const context = appContext(box.home, box.appData), tools = await managedNow(context, await context.read());
      const click = (key: string, on: boolean) => [{ key, on: on, except: [] }];
      const was = await filesIn(box.home);
      const turned = async (on: boolean) => {
        await applySkills(context, tools, click('notes', on));
        await applyServers(context, tools, click('docs', on));
        await applyAgents(context, tools, click('planner', on));
        return filesIn(box.home);
      };
      const taken = changedInTools(was, await turned(false));
      for (const path of ['.copilot/skills/notes/SKILL.md', '.copilot/mcp-config.json', '.copilot/agents/planner.agent.md']) assert.ok(taken.includes(path), `Off took ${path} out`);
      assert.deepEqual(changedInTools(was, await turned(true)), []);
    });
  });
}

// ---------- The first launch over a home with plugin parts (partsmigrate.ts), made by alpha 1's own engine ----------
//
// tests/upgrade/alpha-1-parts is home B with Pi and OpenCode installed and plugins put in by alpha 1 (its README has every case):
// docs as parts in Pi, OpenCode and Codex (pdf and lookup edited in Pi, review deleted from Pi, forms off in OpenCode, writer edited
// in OpenCode), sheet at two versions, picks picked part by part, journal in OpenCode alone, memo (its server switched off in Claude
// Code, its agent no part anywhere) and old as parts in Pi beside Claude Code's whole installs, tasks installed whole. As a person
// meets it at the upgrade, its marketplace gone has been removed and Codex has been left out since. Its first launch runs with
// Synchronize everything on and off, each with Automatic sync on and off; each start in a process of its own, with the plugins
// record's first read before the pass, as main.ts makes it.

/** alpha-1-parts placed as a person meets it at the upgrade (above), with Synchronize everything answered `rule`; `leftOut`: the tools left out. */
async function placeParts(rule: boolean, leftOut: HarnessId[] = ['codex-cli']): Promise<Box> {
  const box = await place('alpha-1-parts');
  await rm(join(box.home, 'gone-market'), { recursive: true });
  const sync = JSON.parse(await readFile(join(box.store, 'sync.json'), 'utf8'));
  await writeFile(join(box.store, 'sync.json'), `${JSON.stringify({ ...sync, leftOut }, null, 2)}\n`);
  assert.deepEqual(await setSyncEverything(appContext(box.home, box.appData), rule, true), {});
  // Every tool file as old as alpha 1 left it, not as new as the copy: a found item is past the settle window at the first pass,
  // so Synchronize everything takes it in then (helper, found in Copilot CLI), whatever the machine's speed.
  const old = new Date('2026-11-13T00:00:00Z');
  for (const path of Object.keys((await filesIn(box.home)).sha256)) if (inTools(path)) await utimes(join(box.home, path), old, old);
  return box;
}
/** The parts' names on the old record, by kind. */
async function partNames(box: Box): Promise<Record<ItemKind, string[]>> {
  const record = await readJson(join(box.store, 'plugin-parts.json')) ?? await readJson(join(box.store, 'plugin-parts.v1.json'));
  const names: Record<ItemKind, string[]> = { skill: [], agent: [], mcp: [] };
  for (const install of record.installs) for (const part of install.items) if (!names[part.kind as ItemKind].includes(part.name)) names[part.kind as ItemKind].push(part.name);
  return names;
}
/** A tool's file of a part's name: a skill's folder, an agent's file (in Pi, kept as a skill), by its path in the home. */
const ofPartName = (names: Record<ItemKind, string[]>) => (path: string) =>
  names.skill.some(name => new RegExp(`^(\\.pi/agent|\\.config/opencode|\\.claude|\\.copilot|\\.codex)/skills/${name}/`).test(path))
  || names.agent.some(name => [`.config/opencode/agents/${name}.md`, `.claude/agents/${name}.md`, `.copilot/agents/${name}.agent.md`, `.codex/agents/${name}.toml`, `.pi/agent/skills/${name}.md`].includes(path));
/** Each tool's MCP entry of each part's name (its shared part and own fields), as the tool's settings hold it now. */
async function partEntries(box: Box, names: string[]) {
  const context = appContext(box.home, box.appData), found: Record<string, string> = {};
  for (const tool of ['claude-cli', 'copilot-cli', 'codex-cli', 'pi-cli', 'opencode-cli'] as const) {
    for (const entry of (await readTool(context, tool)).entries) if (names.includes(entry.name)) found[`${tool} ${entry.name}`] = JSON.stringify([entry.server, entry.extras]);
  }
  return found;
}

for (const rule of [true, false]) for (const sync of ['on', 'off'] as const) {
  describe(`Upgrading alpha-1-parts with Synchronize everything ${rule ? 'on' : 'off'} and Automatic sync ${sync}`, () => {
    let box: Box, made: Files, names: Record<ItemKind, string[]>, entries: Record<string, string>, first: AfterPass[], again: AfterPass[];
    before(async () => {
      box = await placeParts(rule);
      made = await filesIn(box.home);
      names = await partNames(box);
      entries = await partEntries(box, names.mcp);
      first = start(box, sync, 3);
      again = start(box, sync, 1);
    });
    after(() => rm(box.base, { recursive: true, force: true }));

    test(`changes in the tools only the profiles migration’s files${sync === 'on' ? ', the table’s writes into OpenCode (pdf and lookup let go, his edits reaching its unedited copies; sheet’s later version), and alpha 1’s own items joining Pi and OpenCode' : ''}`, async () => {
      // Every file in every tool that changed, and why. OpenCode's settings file and Pi's hold alpha 1's server docs joining them too.
      const joining = ['.config/opencode/agents/planner.md', '.config/opencode/agents/reviewer.md', '.config/opencode/opencode.json', '.pi/agent/mcp.json',
        '.pi/agent/skills/drafts/SKILL.md', '.pi/agent/skills/notes/SKILL.md', '.pi/agent/skills/planner.md', '.pi/agent/skills/reviewer.md', '.pi/agent/skills/style/SKILL.md'];
      const table = ['.config/opencode/skills/pdf/SKILL.md', '.config/opencode/skills/sheet/SKILL.md'];
      // With Synchronize everything on, helper, found in Copilot CLI (no part's name), is taken in and turned On in every tool.
      const takenIn = rule ? ['.claude/agents/helper.md', '.config/opencode/agents/helper.md', '.pi/agent/skills/helper.md'] : [];
      assert.deepEqual(changedInTools(made, first[2].files), ['.claude.json', '.claude/settings.json', ...(sync === 'on' ? [...table, ...joining, ...takenIn] : [])].sort());
      if (sync === 'on') for (const [to, from] of [[table[0], '.pi/agent/skills/pdf/SKILL.md'], [table[1], '.pi/agent/skills/sheet/SKILL.md']]) assert.equal(first[2].files.sha256[to], made.sha256[from], to);
      const opencodeLookup = sync === 'on' ? entries['pi-cli lookup'] : entries['opencode-cli lookup'];
      assert.deepEqual(await partEntries(box, names.mcp), { ...entries, 'opencode-cli lookup': opencodeLookup }, 'each part’s entry in each tool');
      assert.deepEqual([...first, ...again].flatMap(pass => pass.problems), []);
    });

    test('makes every name on the old record, and memo’s agent that was no part, a live item, linked to its plugin or his own, kept out where its part never was or was left out', async () => {
      const plugins = await readJson(join(box.store, 'plugins.json')), whose = (id?: string) => plugins.plugins.find((entry: { id: string }) => entry.id === id)?.plugin ?? 'his';
      const items = Object.fromEntries((['skill', 'agent', 'mcp'] as const).flatMap(kind => [...names[kind], ...(kind === 'agent' ? ['scribe'] : [])].map(name => {
        const item = libraryOf(first[2], kind)[itemKey(name)];
        return [`${kind}:${name}`, item && !item.deleted ? [whose(item.source), item.on, item.except.join(' '), Object.keys(item.applied).sort().join(' ')] : 'none'];
      })));
      // pdf and lookup, edited in Pi (whose folders skills.json and the MCP record know): let go as his own by the first pass, which
      // Sync off doesn't run, and kept where they are. writer, edited in OpenCode (whose folder agents.json never knew): OpenCode kept
      // out, his edit that tool's own. Codex, left out, is decided as the record knew it: its part copies are its own, kept out. one,
      // taken in by Add in alpha 1, was his own already (still applied in Codex). scribe, no part anywhere, is kept out of both.
      const [pdf, lookup] = sync === 'on' ? [['his', true, 'claude-cli copilot-cli codex-cli antigravity-cli', 'opencode-cli pi-cli'], ['his', true, 'claude-cli copilot-cli codex-cli antigravity-cli', 'opencode-cli pi-cli']]
        : [['docs', true, 'codex-cli antigravity-cli', 'opencode-cli pi-cli'], ['docs', true, 'codex-cli antigravity-cli', 'opencode-cli pi-cli']];
      assert.deepEqual(items, {
        'skill:forms': ['docs', true, 'codex-cli opencode-cli antigravity-cli', 'pi-cli'], 'skill:pdf': pdf, 'skill:review': ['docs', true, 'codex-cli pi-cli antigravity-cli', 'opencode-cli'],
        'skill:memo': ['memo', true, 'opencode-cli antigravity-cli', 'pi-cli'], 'skill:journal': ['journal', true, 'pi-cli antigravity-cli', 'opencode-cli'], 'skill:old': ['old', true, 'opencode-cli antigravity-cli', 'pi-cli'],
        'skill:three': ['picks', true, 'pi-cli opencode-cli antigravity-cli', ''], 'skill:two': ['picks', true, 'pi-cli opencode-cli antigravity-cli', ''], 'skill:one': ['his', true, '', 'claude-cli codex-cli copilot-cli pi-cli'],
        'skill:chart': ['sheet', true, 'opencode-cli antigravity-cli', 'pi-cli'], 'skill:sheet': ['sheet', true, 'antigravity-cli', 'opencode-cli pi-cli'],
        'agent:writer': ['docs', true, 'codex-cli pi-cli opencode-cli antigravity-cli', ''], 'agent:scribe': ['memo', true, 'pi-cli opencode-cli antigravity-cli', ''],
        'mcp:lookup': lookup, 'mcp:memo-index': ['memo', true, 'opencode-cli antigravity-cli', 'pi-cli'],
      });
      for (const kind of ['skill', 'agent', 'mcp'] as const) for (const name of names[kind]) assert.ok(!first[2].pages[pageOf[kind]].items.find(row => row.key === itemKey(name))?.takeInAnswers, `${kind}:${name} is not found`);
    });

    test('writes no file in a second or third pass, nor at a second start; plugin-parts.v1.json is the old record, byte for byte', () => {
      // With Sync on, alpha 1's server docs went into Pi and OpenCode at the first pass (On, and they are new here), and the pass after
      // keeps the entry it wrote there as their own part (servers.ts): no part's name, and no tool file.
      const docsOwn = (path: string) => sync === 'on' && /^\.central-knot\/(items\/mcp\/docs\/own\/[0-9a-f]{64}\.json|mcp\.json)$/.test(path);
      assert.deepEqual([writtenBetween(first[0].files, first[1].files).filter(path => !docsOwn(path)), writtenBetween(first[1].files, first[2].files), writtenBetween(first[2].files, again[0].files)], [[], [], []]);
      assert.deepEqual([first[0].files.sha256['.central-knot/plugin-parts.v1.json'], first[0].files.sha256['.central-knot/plugin-parts.json']], [made.sha256['.central-knot/plugin-parts.json'], undefined]);
    });

    test(`tells History of a part’s name ${sync === 'on' ? 'only pdf’s and lookup’s let-go and their edits taken in, and sheet brought up in OpenCode' : 'nothing'}`, async () => {
      const before = new Set(((await readJson(join(fixtures, 'alpha-1-parts/.central-knot/history.json'))).events as HistoryEvent[]).map(event => event.id));
      const told = ((await readJson(join(box.store, 'history.json'))).events as HistoryEvent[]).filter(event => !before.has(event.id)
        && (names.skill.includes(event.key) || [...names.agent, ...names.mcp].some(name => event.key === `agent:${name}` || event.key === `mcp:${name}`)));
      assert.deepEqual(told.map(event => `${event.key} ${event.cause ?? event.kind}`).sort(), sync === 'on' ? ['mcp:lookup edit', 'mcp:lookup own-now', 'pdf edit', 'pdf own-now', 'sheet in-line'] : []);
    });

    test('records the plugins installed whole as without parts, and each plugin some managed tool has, On, kept out of each tool lacking it', async () => {
      const record = await readJson(join(box.store, 'plugins.json'));
      assert.deepEqual(Object.fromEntries(record.plugins.map((entry: PluginEntry) => [entry.plugin, [entry.marketName, entry.on, entry.except.join(' ')]])), {
        tasks: ['team', true, 'codex-cli pi-cli opencode-cli antigravity-cli'], memo: ['team', true, 'copilot-cli codex-cli opencode-cli antigravity-cli'], old: ['gone', true, 'copilot-cli codex-cli opencode-cli antigravity-cli'],
        docs: ['team', true, 'claude-cli copilot-cli codex-cli antigravity-cli'], sheet: ['team', true, 'claude-cli copilot-cli codex-cli antigravity-cli'], picks: ['team', true, 'claude-cli copilot-cli codex-cli opencode-cli antigravity-cli'],
        journal: ['team', true, 'claude-cli copilot-cli codex-cli pi-cli antigravity-cli'] });
      assert.deepEqual(record.tools, ['claude-cli', 'copilot-cli', 'pi-cli', 'opencode-cli']);
    });

    test('leaves the plugins’ items out of profiles: of the parts’ names, switching to Focus would turn Off only his own', async () => {
      const profiles = await readProfiles(box.home), focus = profiles.profiles.find(profile => profile.name === 'Focus')!;
      const parts = (['skill', 'agent', 'mcp'] as const).flatMap(kind => names[kind].map(name => `${kind}:${itemKey(name)}`));
      const turns = switchPlan(focus, homeItems({ ...first[2].pages, profiles }));
      // one was taken in by Add in alpha 1; pdf and lookup, with Sync on, are his own since they were let go. No plugin's item is in the plan.
      assert.deepEqual([...turns.on, ...turns.off].map(item => item.id).filter(id => parts.includes(id)).sort(), sync === 'on' ? ['mcp:lookup', 'skill:one', 'skill:pdf'] : ['skill:one']);
    });

    test(`two automatic checks${sync === 'on' ? ', and each plugin’s Update,' : ' (paused, as Automatic sync is off)'} run no install or uninstall and write nothing`, async () => {
      const { markets, asked } = plugins(box);
      const was = await filesIn(box.home);
      let clock = 1_000_000;
      const updates = autoUpdates({ home: () => box.home, on: () => true, paused: () => sync === 'off', pending: home => markets.pendingUpdates(home), log: () => {}, now: () => clock, every: 60_000,
        api: { install: markets.install, update: markets.update, items: markets.items }, noteJoined: markets.noteJoined, load: async () => undefined, save: async () => {}, changed: () => {} });
      await updates.check();
      clock += 120_000;
      await updates.check();
      if (sync === 'on') for (const plugin of ['docs', 'sheet', 'picks', 'memo']) await markets.items(join(box.home, 'market'), 'team', plugin, ['pi-cli', 'opencode-cli'], box.home, false, true);
      assert.deepEqual([asked, writtenBetween(was, await filesIn(box.home)).filter(path => path !== '.central-knot/plugins.json')], [[], []]);
    });

    // Last, since it changes the home: Codex, left out since, managed again. What its card counts is what the pass then does
    // (tests/managetool.test.ts holds the two equal). Codex was decided as the record knew it, so of a part's name nothing changes.
    if (rule && sync === 'on') test('Codex managed again: no file or entry of a part’s name there changes', async () => {
      const context = appContext(box.home, box.appData), lookup = (await partEntries(box, names.mcp))['codex-cli lookup'];
      assert.deepEqual(await chooseTools(context, 'codex-cli', true), {});
      const was = await filesIn(box.home), joined = start(box, 'on', 1)[0];
      assert.ok(lookup && changedInTools(was, joined.files).some(path => path.startsWith('.codex/')), 'Codex holds lookup, and joining wrote there');
      assert.deepEqual([changedInTools(was, joined.files).filter(ofPartName(names)), (await partEntries(box, names.mcp))['codex-cli lookup']], [[], lookup]);
    });

    // memo's server was switched off in Claude Code from its row before the upgrade: its box and switch are there after it.
    if (rule && sync === 'off') test('memo’s server, switched off in Claude Code before the upgrade, keeps its box and switch there, Off, and turning it On works', async () => {
      const context = appContext(box.home, box.appData), tools = await managedNow(context, await context.read());
      const box_ = async () => (await serversView({ ...context, reads: new Map() }, tools)).items.find(row => row.key === 'memo-index')?.plugin?.['claude-cli'];
      assert.deepEqual(await box_(), { plugin: 'memo', marketplace: 'team', source: join(box.home, 'market'), off: true, name: 'memo-index' });
      const on = await plugins_.setPart({ home: box.home, dataDir: join(box.appData, 'plugins'), binaries: {}, reads: new Map() }, 'team', 'memo', { kind: 'mcp', name: 'memo-index' }, 'claude-cli', true, join(box.home, 'market'));
      assert.deepEqual([on.outcome, (await box_())?.off], ['part-on', undefined]);
    });
  });
}

/**
 * alpha-1-parts brought to this version (start), then its records rewritten as `next` wrote them, which v0.7.0-alpha.5 was cut
 * from: knowing five tools, no sixth in any list and no `knows`, and the sync record at format 2; then Antigravity there (a chosen
 * folder's tool is there by its folder). `excepts`: each plugin's `except`, and each item's linked to one (pdf and lookup, let go as his own, follow the
 * library's rule for a tool joining), as the records hold them now; `saved`, as they held them before; `linked`, those items.
 */
async function fiveToolsThenAntigravity(box: Box) {
  start(box, 'on', 1);
  const records = ['plugins.json', 'skills.json', 'mcp.json', 'agents.json'];
  const plugins = (await readJson(join(box.store, 'plugins.json'))).plugins.map((entry: PluginEntry) => entry.id);
  const excepts = async () => Promise.all(records.map(async name => { const json = await readJson(join(box.store, name));
    return name === 'plugins.json' ? json.plugins.map((entry: PluginEntry) => [entry.plugin, entry.except])
      : Object.entries<LibraryItem>(json.items).filter(([, item]) => plugins.includes(item.source)).map(([key, item]) => [key, item.except]); }));
  const saved = await excepts(), linked: string[] = saved.slice(1).flat().map(([key]: [string]) => key);
  const five = (value: unknown): unknown => (Array.isArray(value) ? value.filter(each => each !== 'antigravity-cli').map(five)
    : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).filter(([key]) => key !== 'knows').map(([key, each]) => [key, five(each)])) : value);
  for (const name of records) await writeFile(join(box.store, name), `${JSON.stringify(five(await readJson(join(box.store, name))), null, 2)}\n`);
  await writeFile(join(box.store, 'sync.json'), `${JSON.stringify({ ...await readJson(join(box.store, 'sync.json')), formatVersion: 2 }, null, 2)}\n`);
  await mkdir(join(box.home, '.gemini/config'), { recursive: true });
  return { excepts, saved, linked };
}

// A home `next` made knew five tools: its records name only those in an `except`. When Antigravity turns up, what they keep out
// of some tool they knew is kept out of it too (pluginrecord.ts bringForward), as the same selections saved now would be.
test('Records that knew five tools: when Antigravity turns up, a plugin kept out of some, and its items, stay out of it', async () => {
  const box = await placeParts(true);
  try {
    const { excepts, saved, linked } = await fiveToolsThenAntigravity(box);
    const was = await filesIn(box.home), after = start(box, 'on', 1)[0];
    const there = changedInTools(was, after.files).filter(path => path.startsWith('.gemini/config/skills/')).map(path => path.split('/')[3]);
    const servers = Object.keys((await readJson(join(box.home, '.gemini/config/mcp_config.json')))?.mcpServers ?? {});
    assert.deepEqual([[...there, ...servers].filter(key => linked.includes(key)), await excepts()], [[], saved]);
  } finally { await rm(box.base, { recursive: true, force: true }); }
});

// The case arrivals.ts exists for: such a home, as the last release left it (its settings keep no tools for it), opened with
// Antigravity there and Automatic sync on, its pass run as main.ts runs it. Antigravity has arrived: each item the pass put there
// is counted and has its own History entry, Copied to Antigravity, and no item of a plugin kept out of some tool is among them.
test('Records that knew five tools, opened with Antigravity there: it has arrived, each copy counted and in History, no kept-out plugin’s item among them', async () => {
  const box = await placeParts(true);
  try {
    const { linked } = await fiveToolsThenAntigravity(box);
    const context = { ...appContext(box.home, box.appData), reads: new Map(), settleMs: 0 }, managed = await managedNow(context, await context.read());
    const before = await seenBefore(undefined, context, managed), told = (await readHistory(context)).length;
    const seen = await observe(context, before, managed, new Date().toISOString(), (await homePass(context, managed, true)).synced);
    const copied = (await readHistory(context)).slice(told).filter(event => event.cause === 'in-line' && event.only === 'antigravity-cli').map(event => libraryEntry(event)!.key).sort();
    const there = [...await readdir(join(box.home, '.gemini/config/skills')), ...Object.keys((await readJson(join(box.home, '.gemini/config/mcp_config.json')))?.mcpServers ?? {})].sort();
    assert.ok(there.length > 0, 'the pass put items there');
    assert.deepEqual([seen.arrived.map(({ tool, copied }) => ({ tool, copied })), copied, copied.filter(key => linked.includes(key))], [[{ tool: 'antigravity-cli', copied: there.length }], there, []]);
  } finally { await rm(box.base, { recursive: true, force: true }); }
});

// The last release reads a sync record above format 2 as written by a newer Central Knot and stops syncing the home (its
// share.ts readRecord; this one's FORMAT_VERSION). Such a home's records are first brought forward, naming Antigravity, by a step
// that runs with Automatic sync on or off (pluginrecord.ts bringForward): each record it saves is saved after the sync record is
// lifted, so a start stopped at any moment leaves a home the last release stops syncing, never one it syncs with a sixth tool named.
test('Records that knew five tools: each one brought forward is saved after the sync record is lifted to format 3, at which the last release stops syncing', async () => {
  const box = await placeParts(true);
  try {
    await fiveToolsThenAntigravity(box);
    const context = appContext(box.home, box.appData), formats: string[] = [];
    const noting = (kind: typeof skillKind | typeof agentKind | typeof serverKind) => ({ open: kind.open, save: async (home: string, library: Parameters<typeof kind.save>[1]) => {
      formats.push(`${kind.kind} saved at format ${(await readRecord(home)).record?.formatVersion}`);
      await kind.save(home, library);
    } });
    assert.equal((await readRecord(box.home)).record?.formatVersion, 2, 'as the last release left it');
    await bringForward(context, [noting(skillKind), noting(agentKind), noting(serverKind)]);
    assert.deepEqual(formats, ['skill saved at format 3', 'agent saved at format 3', 'mcp saved at format 3']);
    assert.deepEqual((await readJson(join(box.store, 'plugins.json'))).knows.includes('antigravity-cli'), true);
  } finally { await rm(box.base, { recursive: true, force: true }); }
});
test('Records that knew five tools, opened with Automatic sync off: nothing is synced, and the sync record is lifted to format 3 all the same', async () => {
  const box = await placeParts(true);
  try {
    await fiveToolsThenAntigravity(box);
    const was = await filesIn(box.home), after = start(box, 'off', 1)[0];
    assert.deepEqual([changedInTools(was, after.files), (await readRecord(box.home)).record?.formatVersion], [[], 3]);
  } finally { await rm(box.base, { recursive: true, force: true }); }
});

// The Plugins page writes the plugins record outside the library's gate, naming every tool this build knows (share.ts liftFirst).
// A home the last release left that this version doesn't remember waits for Resume: a plugin's click there is refused with the
// gate's words and saves nothing, since a record naming Antigravity beside a sync record at format 2 is one the last release reads
// as damaged, then syncs the plugin's items into tools it is kept out of. Remembered, the same click lifts the sync record first.
test('Records that knew five tools, waiting for Resume: a plugin’s click is refused with the gate’s words and saves nothing; remembered, it lifts the sync record first', async () => {
  const box = await placeParts(true);
  try {
    await fiveToolsThenAntigravity(box);
    const settings = appContext(box.home, box.appData).settingsPath, memory = await readFile(settings, 'utf8');
    const entry: PluginEntry = (await readJson(join(box.store, 'plugins.json'))).plugins[0];
    const records = () => Promise.all(['sync.json', 'plugins.json'].map(name => readFile(join(box.store, name), 'utf8')));
    const click = () => plugins(box).markets.turn(entry.source, entry.plugin, entry.on ? 'off' : 'on', undefined, box.home);
    await rm(settings);
    const before = await records(), refused = await click();
    assert.deepEqual([await records(), refused.stopped], [before, 'This app has an intact sync record but no memory of it. Resuming keeps every recorded choice.']);
    await writeFile(settings, memory);
    await click();
    const now: PluginEntry[] = (await readJson(join(box.store, 'plugins.json'))).plugins;
    assert.deepEqual([(await readRecord(box.home)).record?.formatVersion, now.find(each => each.plugin === entry.plugin)?.on], [3, !entry.on]);
  } finally { await rm(box.base, { recursive: true, force: true }); }
});

// alpha-1-parts as alpha 1 left it: the old plugin parts, no plugins record, the sync record at format 2. A start of this version
// first makes the plugins record (marketplaces.ts beforeParts, before any step asks the library's gate), naming Antigravity among
// the tools it was written knowing: the sync record is lifted before it is saved.
test('Plugin parts and no plugins record, sync record at format 2: the start’s first plugins record is saved after the sync record is lifted', async () => {
  const box = await place('alpha-1-parts');
  try {
    const knows = async () => (await readJson(join(box.store, 'plugins.json')))?.knows?.includes('antigravity-cli');
    assert.deepEqual([await knows(), (await readRecord(box.home)).record?.formatVersion], [undefined, 2]);
    await plugins(box).markets.beforeParts();
    assert.deepEqual([await knows(), (await readRecord(box.home)).record?.formatVersion], [true, 3]);
  } finally { await rm(box.base, { recursive: true, force: true }); }
});

/**
 * What a start left of a home, without what two copies of one home differ by (their folder, each plugin's id, and the times and
 * ids History and the versions keep): each tool file's text, each kind's items as their switches stand, the plugins record, and
 * the sync record's format.
 */
async function endState(box: Box) {
  const ids: [string, string][] = (await readJson(join(box.store, 'plugins.json'))).plugins.map((entry: PluginEntry) => [entry.id, `${entry.plugin}@${entry.marketName}`]);
  const plain = (text: string) => ids.reduce((done, [id, name]) => done.replaceAll(id, name), text.replaceAll(box.home, '~'));
  const tools = Object.keys((await filesIn(box.home)).sha256).filter(inTools).sort();
  const items = async (name: string) => Object.entries<LibraryItem>((await readJson(join(box.store, name))).items)
    .map(([key, { on, except, source }]) => plain(JSON.stringify({ key, on, except, source })));
  return {
    tools: await Promise.all(tools.map(async path => [path, plain(await readFile(join(box.home, path), 'utf8'))])),
    items: [...await items('skills.json'), ...await items('mcp.json'), ...await items('agents.json')],
    plugins: plain(await readFile(join(box.store, 'plugins.json'), 'utf8')), format: (await readRecord(box.home)).record?.formatVersion,
  };
}

// A start stopped right after the lift, before anything else was written: only the sync record has changed, so the last release
// refuses the home and nothing in it names Antigravity yet; and this version, opened again, ends as a start never stopped does.
test('Records that knew five tools: a start stopped right after the lift has changed only the sync record, and the next start ends as one never stopped', async () => {
  const [stopped, whole] = [await placeParts(true), await placeParts(true)];
  try {
    for (const box of [stopped, whole]) await fiveToolsThenAntigravity(box);
    const was = await filesIn(stopped.home);
    assert.ok(!('refused' in await libraryGate(appContext(stopped.home, stopped.appData))), 'the lift, as the start’s first step that writes');
    assert.deepEqual([writtenBetween(was, await filesIn(stopped.home)), (await readRecord(stopped.home)).record?.formatVersion], [['.central-knot/sync.json'], 3]);
    for (const box of [stopped, whole]) start(box, 'on', 1);
    assert.deepEqual(await endState(stopped), await endState(whole));
  } finally { for (const box of [stopped, whole]) await rm(box.base, { recursive: true, force: true }); }
});

// Pi left out at the upgrade and managed again later: the move decides it as the record knew it, so nothing he removed there
// comes back and nothing he edited there is written over; memo's agent, which Pi never had, doesn't go there; and a skill journal's
// plugin gains meanwhile doesn't either, since the plugins record keeps journal out of Pi (pluginlibrary.ts pluginOutOf).
describe('Upgrading alpha-1-parts with Pi left out, then managing Pi again', () => {
  let box: Box, made: Files, names: Record<ItemKind, string[]>, entries: Record<string, string>, out: AfterPass[], joined: AfterPass[];
  before(async () => {
    box = await placeParts(true, ['codex-cli', 'pi-cli']);
    // No profiles file: nothing passes before the move, so the MCP record's own migration has just noted Pi's settings file.
    await rm(join(box.store, 'profiles.json'));
    made = await filesIn(box.home);
    names = await partNames(box);
    entries = await partEntries(box, names.mcp);
    out = start(box, 'on', 2);
    await mkdir(join(box.home, 'market/plugins/journal/skills/prompts'), { recursive: true });
    await writeFile(join(box.home, 'market/plugins/journal/skills/prompts/SKILL.md'), '---\nname: prompts\ndescription: Prompts for the day.\n---\n\nAsk one question.\n');
    const read = await plugins(box).markets.items(join(box.home, 'market'), 'team', 'journal', ['opencode-cli'], box.home, false, true);
    assert.equal(read.stopped, undefined);
    assert.deepEqual(await chooseTools(appContext(box.home, box.appData), 'pi-cli', true), {});
    joined = start(box, 'on', 2);
  });
  after(() => rm(box.base, { recursive: true, force: true }));

  test('the move keeps Pi out of lookup, edited there, though the MCP record holds Pi’s settings file; the plugins record keeps Pi out of no plugin it had parts in', async () => {
    const lookup = libraryOf(out[1], 'mcp').lookup, record = await readJson(join(box.store, 'plugins.json'));
    assert.deepEqual([lookup.except.includes('pi-cli'), lookup.applied['pi-cli']], [true, undefined], 'his edit there stays Pi’s own, whatever order a pass takes');
    const keepsPiOut = record.plugins.filter((entry: PluginEntry) => entry.except.includes('pi-cli')).map((entry: PluginEntry) => entry.plugin).sort();
    assert.deepEqual(keepsPiOut, ['journal', 'tasks'], 'only the plugins Pi had no part of');
  });

  test('after two passes no file or entry of a part’s name in Pi has changed since before the upgrade; only alpha 1’s own items join it', async () => {
    const inPi = changedInTools(made, joined[1].files).filter(path => path.startsWith('.pi/'));
    assert.deepEqual(inPi, ['.pi/agent/mcp.json', '.pi/agent/skills/drafts/SKILL.md', '.pi/agent/skills/helper.md', '.pi/agent/skills/notes/SKILL.md', '.pi/agent/skills/planner.md',
      '.pi/agent/skills/reviewer.md', '.pi/agent/skills/style/SKILL.md'], 'alpha 1’s items and helper (taken in), On and kept out of nothing, join Pi as any item does');
    const now = await partEntries(box, names.mcp);
    assert.deepEqual([inPi.filter(ofPartName(names)), now['pi-cli lookup'], now['pi-cli memo-index'], joined[1].files.sha256['.pi/agent/skills/scribe.md'], joined[1].files.sha256['.config/opencode/skills/prompts/SKILL.md'] !== undefined],
      [[], entries['pi-cli lookup'], entries['pi-cli memo-index'], undefined, true], 'prompts reached OpenCode, where journal is');
    assert.deepEqual([...joined].flatMap(pass => pass.problems), []);
  });
});

describe('Upgrading alpha-1-parts while Claude Code’s record of its plugins can’t be read', () => {
  let box: Box, made: Files, names: Record<ItemKind, string[]>, waiting: AfterPass[], then: AfterPass[];
  const installed = '.claude/plugins/installed_plugins.json';
  before(async () => {
    box = await placeParts(true);
    names = await partNames(box);
    const text = await readFile(join(box.home, installed), 'utf8');
    await writeFile(join(box.home, installed), text.slice(0, 40));
    made = await filesIn(box.home);
    waiting = start(box, 'on', 2);
    await writeFile(join(box.home, installed), text);
    then = start(box, 'on', 2);
  });
  after(() => rm(box.base, { recursive: true, force: true }));

  test('the migration waits: no plugins record, no part’s name taken in or changed, and each page shows those copies waiting', () => {
    assert.deepEqual([waiting[1].files.sha256['.central-knot/plugins.json'], waiting[1].files.sha256['.central-knot/plugin-parts.json']], [undefined, made.sha256['.central-knot/plugin-parts.json']]);
    assert.deepEqual(changedInTools(made, waiting[1].files).filter(ofPartName(names)), []);
    for (const kind of ['skill', 'agent', 'mcp'] as const) for (const name of names[kind]) {
      if (name === 'one') continue;
      assert.equal(libraryOf(waiting[1], kind)[itemKey(name)], undefined, `${kind}:${name} is not taken in`);
      const row = waiting[1].pages[pageOf[kind]].items.find(each => each.key === itemKey(name));
      // A part left out on a first pick, never written, has no copy, so no row.
      if (!row) { assert.ok(['two', 'three'].includes(name), `${kind}:${name} has a row`); continue; }
      assert.match(Object.values(row?.unseen ?? {})[0] ?? '', /waiting to be moved to the library/, `${kind}:${name} shows waiting`);
    }
  });

  test('once it can be read, the next start moves every part’s name to a live item', () => {
    for (const kind of ['skill', 'agent', 'mcp'] as const) for (const name of names[kind]) assert.ok(libraryOf(then[1], kind)[itemKey(name)] && !libraryOf(then[1], kind)[itemKey(name)].deleted, `${kind}:${name}`);
    assert.equal(then[1].files.sha256['.central-knot/plugin-parts.json'], undefined);
  });
});

/**
 * docs, whose parts wait to be moved, as the page and the automatic updates meet it in a waiting home: Pi's line, then On, Install
 * there in Pi, two automatic checks (what Update all would run: Update has nothing more, as a waiting plugin has no Its items),
 * and Off, then Pi's line again. `partsWait` is why the move waits, as the pass gives it to main.ts (homepass.ts partsWait).
 */
async function docsWhileWaiting(box: Box) {
  const context = { ...appContext(box.home, box.appData), reads: new Map() }, market = join(box.home, 'market');
  const { partsWait } = await homePass(context, await managedNow(context, await context.read()), false);
  const { markets, asked } = plugins(box, partsWait);
  const piLine = async () => {
    const shown = await markets.view(), entry = shown.marketplaces.find(each => each.name === 'team')!;
    return { ...toolMark(shown, entry, 'docs', 'pi-cli', entry.switches?.docs?.tools['pi-cli']), waiting: entry.waiting, items: entry.items?.docs };
  };
  const before = await piLine();
  for (const [what, tool] of [['on', undefined], ['let-in', 'pi-cli']] as const) await markets.turn(market, 'docs', what, tool, box.home);
  let clock = 1_000_000;
  const updates = autoUpdates({ home: () => box.home, on: () => true, paused: () => false, pending: home => markets.pendingUpdates(home), log: () => {}, now: () => clock, every: 60_000,
    api: { install: markets.install, update: markets.update, items: markets.items }, noteJoined: markets.noteJoined, load: async () => undefined, save: async () => {}, changed: () => {} });
  await updates.check();
  clock += 120_000;
  await updates.check();
  await markets.turn(market, 'docs', 'off', undefined, box.home);
  // The library's live items after them, each as kind:key.
  const live = (await Promise.all(([['skill', skillKind], ['mcp', serverKind], ['agent', agentKind]] as const).map(async ([kind, of]) =>
    Object.values((await of.open(context)).library.items).filter(item => !item.deleted).map(item => `${kind}:${item.key}`)))).flat();
  return { partsWait, before, after: await piLine(), asked, live };
}
const WAITS = 'Pi: parts of it from an earlier version wait to be moved to the library, so nothing changes there until they are.';

// The realistic wait: alpha 1 used only for Plugins, so first setup was never answered: there is no sync record, and the app
// remembers none. The move waits, and so does each plugin with a part on record in Pi and OpenCode (pluginstatus.ts waitsToMove).
describe('Upgrading alpha-1-parts with no sync record: docs waits in Pi and OpenCode, and its Off made meanwhile reaches them at the move', () => {
  let box: Box, made: Files, names: Record<ItemKind, string[]>, entries: Record<string, string>, waited: Files, waitedEntries: Record<string, string>,
    waitStart: AfterPass[], clicked: Awaited<ReturnType<typeof docsWhileWaiting>>, moved: AfterPass[];
  before(async () => {
    box = await place('alpha-1-parts');
    await rm(join(box.home, 'gone-market'), { recursive: true });
    await rm(join(box.store, 'sync.json'));
    await writeFile(appContext(box.home, box.appData).settingsPath, '{}\n');
    made = await filesIn(box.home);
    names = await partNames(box);
    entries = await partEntries(box, names.mcp);
    waitStart = start(box, 'on', 1);
    clicked = await docsWhileWaiting(box);
    waited = await filesIn(box.home);
    waitedEntries = await partEntries(box, names.mcp);
    assert.deepEqual(await setSyncEverything(appContext(box.home, box.appData), true, true), {});
    moved = start(box, 'on', 2);
  });
  after(() => rm(box.base, { recursive: true, force: true }));

  test('while it waits, Pi’s line says so and why, and On, a tick on Pi’s box, the checks and Off write and take in nothing of a part’s name, anywhere', () => {
    const why = 'This home has no sync record yet: answer the question on the Overview, and they are moved at the next look.';
    assert.equal(clicked.partsWait, why);
    assert.deepEqual([clicked.before.mark, clicked.before.words, clicked.before.items, clicked.before.waiting?.includes('docs')],
      ['parts-waiting', `${WAITS} ${why} Turning the plugin off reaches Pi when they are moved.`, undefined, true]);
    assert.equal(clicked.after.words, `${WAITS} ${why} The plugin is off, so they turn off in Pi when they are moved, apart from any you edited there, which stay as they are.`);
    assert.deepEqual([clicked.asked, changedInTools(made, waited).filter(ofPartName(names)), waitedEntries, waited.sha256['.central-knot/plugin-parts.json']],
      [[], [], entries, made.sha256['.central-knot/plugin-parts.json']]);
    // one was his own item before the upgrade (taken in with Add in alpha 1).
    const parts = (['skill', 'agent', 'mcp'] as const).flatMap(kind => names[kind].filter(name => name !== 'one').map(name => `${kind}:${itemKey(name)}`));
    assert.deepEqual([parts.filter(id => !!libraryOf(waitStart[0], id.split(':')[0] as ItemKind)[id.slice(id.indexOf(':') + 1)]), parts.filter(id => clicked.live.includes(id))], [[], []], 'none taken in by the pass or the clicks');
  });

  test('once first setup is answered, the next start moves every part’s name; docs’ items are Off, its unedited copies taken out, his edited ones left byte for byte', () => {
    for (const kind of ['skill', 'agent', 'mcp'] as const) for (const name of names[kind]) assert.ok(libraryOf(moved[1], kind)[itemKey(name)] && !libraryOf(moved[1], kind)[itemKey(name)].deleted, `${kind}:${name}`);
    const docs = [['skill', 'forms'], ['skill', 'pdf'], ['skill', 'review'], ['agent', 'writer'], ['mcp', 'lookup']] as const;
    assert.deepEqual(docs.map(([kind, name]) => libraryOf(moved[1], kind)[itemKey(name)].on), [false, false, false, false, false]);
    const now = moved[1].files.sha256, gone = ['.pi/agent/skills/forms/SKILL.md', '.config/opencode/skills/pdf/SKILL.md', '.config/opencode/skills/review/SKILL.md'];
    assert.deepEqual(gone.map(path => [made.sha256[path] !== undefined, now[path]]), gone.map(() => [true, undefined]), 'unedited: taken out');
    const kept = ['.pi/agent/skills/pdf/SKILL.md', '.config/opencode/agents/writer.md'];
    assert.deepEqual(kept.map(path => now[path]), kept.map(path => made.sha256[path]), 'edited: his, byte for byte');
    assert.deepEqual([moved[1].files.sha256['.central-knot/plugin-parts.json'], [...moved].flatMap(pass => pass.problems)], [undefined, []]);
  });

  test('the edited server copy in Pi stays his, byte for byte, and OpenCode’s unedited one is taken out', async () => {
    const now = await partEntries(box, names.mcp);
    assert.deepEqual([now['pi-cli lookup'], now['opencode-cli lookup']], [entries['pi-cli lookup'], undefined]);
  });
});

describe('Upgrading alpha-1-parts while Claude Code’s record of its plugins can’t be read: docs’ clicks and the checks change nothing', () => {
  let box: Box, made: Files, names: Record<ItemKind, string[]>, clicked: Awaited<ReturnType<typeof docsWhileWaiting>>, waited: Files;
  before(async () => {
    box = await placeParts(true);
    names = await partNames(box);
    const installed = join(box.home, '.claude/plugins/installed_plugins.json');
    await writeFile(installed, (await readFile(installed, 'utf8')).slice(0, 40));
    made = await filesIn(box.home);
    start(box, 'on', 1);
    clicked = await docsWhileWaiting(box);
    waited = await filesIn(box.home);
  });
  after(() => rm(box.base, { recursive: true, force: true }));

  test('Pi’s line says it waits and why; nothing of a part’s name is written or taken in, and no plugins record is made', () => {
    assert.deepEqual([clicked.before.mark, clicked.before.words], ['parts-waiting', `${WAITS} The plugins record isn’t made yet: it is made once every tool’s record of its plugins can be read. Turning the plugin off reaches Pi when they are moved.`]);
    const taken = (['skill', 'agent', 'mcp'] as const).flatMap(kind => names[kind].filter(name => name !== 'one').map(name => `${kind}:${itemKey(name)}`)).filter(id => clicked.live.includes(id));
    assert.deepEqual([clicked.asked, changedInTools(made, waited).filter(ofPartName(names)), taken, waited.sha256['.central-knot/plugins.json']], [[], [], [], undefined]);
  });
});

/**
 * This version's plugins for the home: the real engine but for each tool's commands, which only note what was asked. `partsWait`:
 * why the move of parts waits, as main.ts keeps it from the last pass.
 */
function plugins(box: Box, partsWait?: string) {
  const context = appContext(box.home, box.appData), asked: string[] = [];
  const host: MarketplaceHost = {
    home: () => ({ home: box.home }), dataDir: join(box.appData, 'data'), pickFolder: async () => undefined, openExternal: async () => {},
    read: async () => ({ tools: await managedNow(context, await context.read()), snapshots: [] }),
    leftOut: async () => (await readRecord(box.home)).record?.leftOut ?? [], writeAccess: () => writeAccess(context), share: () => context, partsWait: () => partsWait,
  };
  const noted = (what: string) => async (...args: unknown[]) => { asked.push(`${what} ${args.slice(2, 4).join(' ')}`); return { tool: args[3], outcome: 'failed', message: 'Not in this test.', runs: [] } as never; };
  const use: MarketplaceEngine = { findClis: async () => ({ binaries: { 'claude-cli': '/bin/true', 'copilot-cli': '/bin/true' }, apps: {} }), checkAccess: noted('check'), addMarketplace: noted('add marketplace'),
    readCatalog: plugins_.readCatalog, readRemotePlugin: plugins_.readRemotePlugin, install: noted('install'), uninstall: noted('uninstall'), update: noted('update'), setSkill: noted('skill'), setPart: noted('part'), setWhole: noted('whole') };
  return { markets: createMarketplaces(host, use, []), asked };
}
