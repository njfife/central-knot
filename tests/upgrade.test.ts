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
import { applyServers } from '../src/servers.ts';
import { setSyncEverything } from '../src/everything.ts';
import { managedNow, readRecord, syncGate, writeAccess } from '../src/share.ts';
import { asksNow } from '../src/setupcounts.ts';
import { applySkills } from '../src/skills.ts';
import type { HarnessId, HistoryEvent, HomeView } from '../src/types.ts';
import { appContext, filesIn, type AfterPass, type Files } from './upgrade/start.ts';

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
        // With Sync on, the first pass took the waiting edit in: notes is at it.
        assert.equal(item.hash, was.id === 'skill:notes' && sync === 'on' ? waitingNow : was.hash, `${was.id} is at the content it had`);
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
