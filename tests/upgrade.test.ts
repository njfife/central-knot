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
import { cp, mkdir, mkdtemp, readFile, realpath, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { isAbsolute, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { agentsFolder } from '../src/agentfiles.ts';
import { applyAgents } from '../src/agents.ts';
import { libraryEntry } from '../src/historyactions.ts';
import { itemKey, type ItemKind, type LibraryItem } from '../src/library.ts';
import { homeItems, inUse } from '../src/profileplan.ts';
import { readProfiles } from '../src/profiles.ts';
import { serverHash } from '../src/mcp.ts';
import { applyServers } from '../src/servers.ts';
import { setSyncEverything } from '../src/everything.ts';
import { managedNow, readRecord, syncGate, writeAccess } from '../src/share.ts';
import { asksNow } from '../src/setupcounts.ts';
import { applySkills } from '../src/skills.ts';
import type { HarnessId, HistoryEvent, HomeView } from '../src/types.ts';
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
  // drafts's switch is released (Claude Code's skillOverrides goes with its last entry); search's deny is kept while Claude
  // Code has its entry, which goes only at Write to Claude Code (servers.ts releaseKeptDenies clears it later).
  '.claude/settings.json': '{\n  "deniedMcpServers": [\n    {\n      "serverName": "search"\n    }\n  ]\n}\n',
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
async function place(folder: OldHome['folder']): Promise<Box> {
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
    for (const [at, was] of Object.entries<object>(record.roots ?? {})) Object.assign(was, await seen(isAbsolute(at) ? at : agentsFolder(context, at as HarnessId)));
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
      const { profiles } = await readProfiles(box.home);
      assert.deepEqual(inUse(profiles, homeItems(first[0].pages)).map(profile => profile.name), ['Focus']);
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

// ---------- The first launch with a plugins record (pluginrecord.ts), over a home with plugins the version before left ----------
//
// The home is alpha-1 with plugins in its tools, as their own commands write them (the shapes tests/plugins.test.ts uses: no
// version of Central Knot writes a tool's install record), and Pi's parts made by parts.ts, whose record has kept alpha.1's
// form: pdf installed in Claude Code, and in Copilot CLI turned off there by its own switch; memo in Claude Code and as parts
// in Pi; xlsx in Claude Code from the Anthropic Directory; old in Claude Code from a marketplace that can't be read now; and
// pdf in Codex, which is left out. Its first launch reads the Plugins page, then two automatic checks run, by this version's
// own code, with each tool's commands replaced by stand-ins that note what was asked of them.
describe('Upgrading alpha-1 with plugins in its tools', () => {
  let box: Box;
  const market = () => join(box.base, 'market');
  const skill = (name: string) => `---\nname: ${name}\ndescription: The ${name} skill.\n---\n\nUse ${name}.\n`;
  const put = async (path: string, text: string) => { await mkdir(join(path, '..'), { recursive: true }); await writeFile(path, text); };
  const asked: string[] = [];
  let made: Files;
  before(async () => {
    box = await place('alpha-1');
    const home = box.home;
    await put(join(market(), '.claude-plugin/marketplace.json'), JSON.stringify({ name: 'team', plugins: ['pdf', 'memo', 'xlsx'].map(name => ({ name, source: `./plugins/${name}` })) }));
    for (const name of ['pdf', 'memo', 'xlsx']) await put(join(market(), `plugins/${name}/skills/${name}/SKILL.md`), skill(name));
    const copy = async (root: string, name: string) => { await put(join(root, `skills/${name}/SKILL.md`), skill(name)); return root; };
    // Claude Code: pdf and memo from team, xlsx from the Anthropic Directory, old from a marketplace whose folder is gone now.
    const claude = (name: string, marketName = 'team') => copy(join(home, '.claude/plugins/cache', marketName, name, 'unknown'), name);
    await put(join(home, '.claude/plugins/known_marketplaces.json'), JSON.stringify({ team: { source: { source: 'git', url: market() } }, gone: { source: { source: 'git', url: join(box.base, 'gone-market') } } }));
    await put(join(home, '.claude/plugins/installed_plugins.json'), JSON.stringify({ version: 2, plugins: {
      'pdf@team': [{ scope: 'user', installPath: await claude('pdf'), version: 'unknown' }], 'memo@team': [{ scope: 'user', installPath: await claude('memo'), version: 'unknown' }],
      'xlsx@anthropic-plugin-directory': [{ scope: 'user', installPath: await claude('xlsx', 'anthropic-plugin-directory'), version: 'unknown', directoryRepositoryKey: 'github.com/acme/xlsx#' }],
      'old@gone': [{ scope: 'user', installPath: await claude('old', 'gone'), version: 'unknown' }] } }));
    // Copilot CLI: pdf, turned off with its own switch.
    await put(join(home, '.copilot/settings.json'), JSON.stringify({ extraKnownMarketplaces: { team: { source: { source: 'git', url: market() } } } }));
    await put(join(home, '.copilot/config.json'), JSON.stringify({ installedPlugins: [{ name: 'pdf', marketplace: 'team', cache_path: await copy(join(home, '.copilot/installed-plugins/team/pdf'), 'pdf'), enabled: false }] }));
    // Codex: pdf, and Codex is left out of Central Knot here.
    await writeFile(join(home, '.codex/config.toml'), `${await readFile(join(home, '.codex/config.toml'), 'utf8')}\n[marketplaces.team]\nsource = ${JSON.stringify(market())}\n\n[plugins."pdf@team"]\nenabled = true\n`);
    await copy(join(home, '.codex/plugins/cache/team/pdf/local'), 'pdf');
    const sync = JSON.parse(await readFile(join(box.store, 'sync.json'), 'utf8'));
    await writeFile(join(box.store, 'sync.json'), `${JSON.stringify({ ...sync, leftOut: ['codex-cli'] }, null, 2)}\n`);
    // Pi: memo's parts, put in by parts.ts as the Plugins page did.
    await mkdir(join(home, '.pi/agent'), { recursive: true });
    const { markets } = plugins();
    const putIn = await markets.parts(market(), 'team', 'memo', 'pi-cli', 'install', undefined, home);
    assert.equal(putIn.reports[0]?.outcome, 'installed', JSON.stringify(putIn));
    asked.length = 0;
    made = await filesIn(home);
  });
  after(() => rm(box.base, { recursive: true, force: true }));

  /** This version's plugins for the home: the real engine but for each tool's commands, which only note what was asked. */
  function plugins() {
    const context = appContext(box.home, box.appData);
    const host: MarketplaceHost = {
      home: () => ({ home: box.home }), dataDir: join(box.appData, 'data'), pickFolder: async () => undefined, openExternal: async () => {},
      read: async () => ({ tools: await managedNow(context, await context.read()), snapshots: [] }),
      leftOut: async () => (await readRecord(box.home)).record?.leftOut ?? [], writeAccess: () => writeAccess(context), share: () => context,
    };
    const noted = (what: string) => async (...args: unknown[]) => { asked.push(`${what} ${args.slice(2, 4).join(' ')}`); return { tool: args[3], outcome: 'failed', message: 'Not in this test.', runs: [] } as never; };
    const use: MarketplaceEngine = { findClis: async () => ({ binaries: { 'claude-cli': '/bin/true', 'copilot-cli': '/bin/true' }, apps: {} }), checkAccess: noted('check'), addMarketplace: noted('add marketplace'),
      readCatalog: plugins_.readCatalog, readRemotePlugin: plugins_.readRemotePlugin, install: noted('install'), uninstall: noted('uninstall'), update: noted('update'), setSkill: noted('skill'), setPart: noted('part'), setWhole: noted('whole') };
    return { markets: createMarketplaces(host, use, []) };
  }

  test('the first launch and two automatic checks run no install or uninstall, and leave every tool file and the parts record as they were', async () => {
    const { markets } = plugins();
    await markets.view();
    let clock = 1_000_000;
    const updates = autoUpdates({ home: () => box.home, on: () => true, paused: () => false, pending: home => markets.pendingUpdates(home), log: () => {}, now: () => clock, every: 60_000,
      api: { install: markets.install, update: markets.update, parts: markets.parts }, noteJoined: markets.noteJoined, load: async () => undefined, save: async () => {}, changed: () => {} });
    await updates.check();
    clock += 120_000;
    await updates.check();
    assert.deepEqual(asked, []);
    const now = await filesIn(box.home);
    assert.deepEqual([changedInTools(made, now), now.sha256['.central-knot/plugin-parts.json'] === made.sha256['.central-knot/plugin-parts.json']], [[], true]);
  });

  test('plugins.json holds each plugin some managed tool has, On, kept out of every tool that lacks it; not the Directory’s copy; every managed tool on its list', async () => {
    const record = await readJson(join(box.store, 'plugins.json'));
    const entries = Object.fromEntries(record.plugins.map((entry: { plugin: string; on: boolean; except: string[]; marketName: string }) => [entry.plugin, [entry.marketName, entry.on, entry.except]]));
    assert.deepEqual(entries, {
      pdf: ['team', true, ['codex-cli', 'pi-cli', 'opencode-cli']],
      memo: ['team', true, ['copilot-cli', 'codex-cli', 'opencode-cli']],
      old: ['gone', true, ['copilot-cli', 'codex-cli', 'pi-cli', 'opencode-cli']] });
    assert.deepEqual(record.tools, ['claude-cli', 'copilot-cli', 'pi-cli']);
  });

  test('a later look writes nothing: the record stays as the first launch made it', async () => {
    const was = await filesIn(box.home);
    await plugins().markets.view();
    assert.deepEqual(writtenBetween(was, await filesIn(box.home)), []);
  });
});
