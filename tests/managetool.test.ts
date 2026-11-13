// A tool's Manage switch on real files, one worked example for each way it can go wrong (toolchoice.ts chooseTools, and what
// turning a tool on does there: whatJoiningDoes). A home with Claude Code, Copilot CLI and Codex installed (their folders: a
// chosen folder is read by its folders), holding one skill (notes), one MCP server (docs) and one agent (reviewer); passes run
// as main.ts runs them (homepass.ts homePass with the managed tools of the moment). Codex is the tool switched.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdir, mkdtemp, readFile, readdir, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { agentsView, applyAgents, restoreAgent } from '../src/agents.ts';
import { readHistory } from '../src/history.ts';
import { homePass } from '../src/homepass.ts';
import { applyBase, baseView, instructionsView, saveInstruction, undoBase } from '../src/instructions.ts';
import type { LibraryItem } from '../src/library.ts';
import { libraryAction, librarySentence } from '../src/historyactions.ts';
import { libraryWords, sentences, statusLine } from '../src/libraryrow.ts';
import { saveProfile, switchProfile } from '../src/profiles.ts';
import { setDisabled } from '../src/skillswitch.ts';
import { applyServers, serversView, writeToClaude } from '../src/servers.ts';
import { setSyncEverything } from '../src/everything.ts';
import { managedNow, readRecord, syncGate, type ShareContext } from '../src/share.ts';
import { applySkills, clearSwitch, restoreSkill, skillsView, takeOver } from '../src/skills.ts';
import { chooseTools, whatJoiningDoes } from '../src/toolchoice.ts';
import type { Change, HarnessId, JoinCounts, PassResult } from '../src/types.ts';
import { connectRepo, pullRepo, pushRepo } from '../src/gitrepo.ts';
import { applySkillsIn, seedServerAndAgent, skill, skillText as repoSkill, world } from './gitrepo-world.ts';
import { appContext, filesIn } from './upgrade/start.ts';

const skillText = (body = 'Take notes.') => `---\nname: notes\ndescription: Notes.\n---\n\n${body}\n`;
const agentText = (prompt = 'Review code.') => `---\nname: reviewer\ndescription: Reviews code\n---\n\n${prompt}\n`;
const codexAgentText = (prompt: string) => `name = "reviewer"\ndescription = "Reviews code"\ndeveloper_instructions = """\n${prompt}\n"""\n`;
const docs = (port = 7) => ({ mcpServers: { docs: { type: 'local', command: 'docs-server', args: ['--port', String(port)], tools: ['*'] } } });
const CODEX = { skill: '.codex/skills/notes/SKILL.md', agent: '.codex/agents/reviewer.toml', config: '.codex/config.toml' };

/** Each kind's items as its record holds them, by the page's name for the kind. */
type Items = Record<string, Record<string, LibraryItem>>;

/** The home: three tools' folders (OpenCode's too, `opencode`), notes and reviewer in Claude Code, docs in Copilot CLI; nothing in Central Knot yet. */
async function box({ opencode = false } = {}) {
  const base = await realpath(await mkdtemp(join(tmpdir(), 'ck-manage-')));
  const home = join(base, 'home');
  for (const folder of ['.claude/skills/notes', '.claude/agents', '.copilot/skills', '.copilot/agents', '.codex/skills', '.codex/agents', ...(opencode ? ['.config/opencode'] : [])]) await mkdir(join(home, folder), { recursive: true });
  await writeFile(join(home, '.claude/skills/notes/SKILL.md'), skillText());
  await writeFile(join(home, '.claude/agents/reviewer.md'), agentText());
  await writeFile(join(home, '.copilot/mcp-config.json'), JSON.stringify(docs()));
  const context: ShareContext = { ...appContext(home, join(base, 'data')), settleMs: 0 };
  const managed = async () => managedNow(context, await context.read());
  /** A pass of the whole home, as main.ts runs it with Automatic sync on. */
  const pass = async () => (await homePass({ ...context, reads: new Map() }, await managed(), true)).synced!;
  /** Turns notes, docs and reviewer On, as their Add does. */
  const turnOn = async () => {
    const tools = await managed(), on = (key: string): Change[] => [{ key, managed: true, off: [] }];
    const done = [await applySkills(context, tools, on('notes')), await applyServers(context, tools, on('docs')), await applyAgents(context, tools, on('reviewer'))];
    assert.deepEqual(done.map(result => result.stopped), [undefined, undefined, undefined]);
  };
  const read = (path: string) => readFile(join(home, path), 'utf8').catch(() => undefined);
  /** Every file outside .central-knot: its bytes, and a stamp that changes whenever it is written. */
  const toolFiles = async () => {
    const all = await filesIn(home), mine = (path: string) => !path.startsWith('.central-knot/');
    return { sha256: Object.fromEntries(Object.entries(all.sha256).filter(([path]) => mine(path))), stamp: Object.fromEntries(Object.entries(all.stamp).filter(([path]) => mine(path))) };
  };
  /** Each kind's items as its record holds them. */
  const items = async (): Promise<Items> => Object.fromEntries(await Promise.all(['skills', 'mcp', 'agents'].map(async kind =>
    [kind, JSON.parse(await readFile(join(home, '.central-knot', `${kind}.json`), 'utf8').catch(() => '{}')).items ?? {}] as const)));
  const history = () => readHistory(context);
  return { base, home, context, managed, pass, turnOn, read, toolFiles, items, history, cleanup: () => rm(base, { recursive: true, force: true }) };
}
type Box = Awaited<ReturnType<typeof box>>;

/**
 * What a pass did in one tool, counted as the card's line counts it (types.ts JoinCounts): writes, removals and writes that wait
 * from its results; copies kept from that tool from the versions it added; items taken in from the items it made live; and the
 * found items there from the pages' own rows (a copy of its own, or one it has another way) after it.
 */
async function didIn(b: Box, tool: HarnessId, done: { skills?: PassResult; servers?: PassResult; agents?: PassResult }, before: Items): Promise<JoinCounts> {
  const after = await b.items(), managed = await b.managed();
  const results = [done.skills, done.servers, done.agents].flatMap(result => result?.results ?? []).filter(result => result.harness === tool);
  const kept = Object.entries(after).flatMap(([kind, list]) => Object.values(list).flatMap(item => item.versions
    .filter(version => version.from.harness === tool && version.from.how === 'was-in' && !before[kind]?.[item.key]?.versions.some(old => old.hash === version.hash))));
  const live = (list: Record<string, LibraryItem> | undefined, key: string) => !!list?.[key] && !list[key].deleted;
  const takenIn = Object.entries(after).flatMap(([kind, list]) => Object.keys(list).filter(key => live(list, key) && !live(before[kind], key)));
  const views = [await skillsView(b.context, managed), await serversView(b.context, managed), await agentsView(b.context, managed)];
  const found = views.flatMap(view => view.items.filter(fact => !live(view.library, fact.key) && (fact.copies[tool] || fact.anotherWay?.[tool])));
  return { written: results.filter(result => result.outcome === 'written').length, kept: kept.length, removed: results.filter(result => result.outcome === 'removed').length,
    waits: results.filter(result => result.waits).length, found: found.length, takenIn: takenIn.length };
}
const counts = (some: Partial<JoinCounts>): JoinCounts => ({ written: 0, kept: 0, removed: 0, waits: 0, found: 0, takenIn: 0, ...some });

/** A tool turned on, with what its card said before the click, and what the pass then did there. */
async function turnOnTool(b: Box, tool: HarnessId = 'codex-cli', rule = false) {
  const said = await whatJoiningDoes(b.context, await b.managed(), tool, rule);
  const before = await b.items();
  assert.deepEqual(await chooseTools(b.context, tool, true), {});
  const did = await didIn(b, tool, await b.pass(), before);
  return { said, did };
}
const turnCodexOn = (b: Box) => turnOnTool(b);

test('Off then On with nothing changed writes no file, in the tools or in the records’ items, either time; History has the two flips', async () => {
  const b = await box();
  try {
    await b.turnOn();
    await b.pass();
    const files = await b.toolFiles(), items = await b.items(), told = (await b.history()).length;
    assert.deepEqual(await chooseTools(b.context, 'codex-cli', false), {});
    await b.pass();
    assert.deepEqual([await b.toolFiles(), await b.items()], [files, items], 'turned off');
    const { said, did } = await turnCodexOn(b);
    assert.deepEqual([await b.toolFiles(), await b.items()], [files, items], 'turned on again');
    assert.deepEqual([said, did], [counts({}), counts({})], 'its card said nothing would change, and nothing did');
    const added = (await b.history()).slice(told);
    assert.deepEqual(added.map(event => [event.kind, event.key, event.item, event.managing]), [
      ['managing', 'tool:codex-cli', 'Codex', { tool: 'codex-cli', on: false }], ['managing', 'tool:codex-cli', 'Codex', { tool: 'codex-cli', on: true }]]);
  } finally { await b.cleanup(); }
});

test('As the first act in a home with no record, turning a tool off makes the record, leaves Synchronize everything unanswered, and is remembered', async () => {
  const b = await box();
  try {
    assert.equal((await syncGate(b.context)).state, 'first-setup');
    assert.deepEqual(await chooseTools(b.context, 'codex-cli', false), {});
    const { record } = await readRecord(b.home);
    assert.deepEqual([record?.leftOut, 'syncEverything' in record!, (await syncGate(b.context)).state], [['codex-cli'], false, 'ready']);
    assert.deepEqual((await readdir(join(b.home, '.central-knot'))).sort(), ['history.json', 'sync.json'], 'no library record is written for a folder nothing knew');
    assert.deepEqual(await b.managed(), ['claude-cli', 'copilot-cli']);
    // On again, the record keeps no list: a home with none left out reads as every installed tool managed.
    await chooseTools(b.context, 'codex-cli', true);
    assert.equal((await readRecord(b.home)).record?.leftOut, undefined);
  } finally { await b.cleanup(); }
});

test('A tool never managed before, with differing copies of items that are On: each copy is kept as a version, then written over, as its card said', async () => {
  const b = await box();
  try {
    await chooseTools(b.context, 'codex-cli', false);
    await mkdir(join(b.home, '.codex/skills/notes'), { recursive: true });
    await writeFile(join(b.home, CODEX.skill), skillText('Codex’s own notes.'));
    await writeFile(join(b.home, CODEX.agent), codexAgentText('Codex’s own reviewer.'));
    await writeFile(join(b.home, CODEX.config), '[mcp_servers.docs]\ncommand = "docs-server"\nargs = ["--port", "9"]\n');
    await b.turnOn();
    const codexBefore = { skill: await b.read(CODEX.skill), agent: await b.read(CODEX.agent) };
    const { said, did } = await turnCodexOn(b);
    assert.deepEqual([said, did], [counts({ written: 3, kept: 3 }), counts({ written: 3, kept: 3 })]);
    assert.equal(await b.read(CODEX.skill), skillText());
    assert.match((await b.read(CODEX.config))!, /"--port", "7"/);
    // Every content that was in Codex is a version now, from Codex, and History says each copy that was written over.
    const items = await b.items();
    for (const [kind, key] of [['skills', 'notes'], ['mcp', 'docs'], ['agents', 'reviewer']]) {
      assert.ok(items[kind][key].versions.some(version => version.from.how === 'was-in' && version.from.harness === 'codex-cli'), `${key}: Codex’s copy is a version`);
    }
    assert.ok(codexBefore.skill && codexBefore.agent);
    const written = (await b.history()).filter(event => event.losers.some(loser => loser.tool === 'codex-cli'));
    assert.deepEqual(written.map(event => event.key).sort(), ['agent:reviewer', 'mcp:docs', 'notes']);
  } finally { await b.cleanup(); }
});

test('Off, a hand edit in the tool, On: the edit is kept as a version (History can make it current), and the library wins there', async () => {
  const b = await box();
  try {
    await b.turnOn();
    await chooseTools(b.context, 'codex-cli', false);
    await writeFile(join(b.home, CODEX.skill), skillText('Edited in Codex while it was left out.'));
    await b.pass();
    assert.equal(await b.read('.claude/skills/notes/SKILL.md'), skillText(), 'an edit in a tool left out does not spread');
    const { said, did } = await turnCodexOn(b);
    assert.deepEqual([said, did], [counts({ written: 1, kept: 1 }), counts({ written: 1, kept: 1 })]);
    assert.equal(await b.read(CODEX.skill), skillText());
    const kept = (await b.history()).find(event => event.kind === 'kept-edit' && event.cause === 'tool-back');
    assert.deepEqual(kept?.losers.map(loser => loser.tool), ['codex-cli'], 'History says the copy that gave way');
  } finally { await b.cleanup(); }
});

test('Off and On again with no pass between (Automatic sync off): a hand edit made there meanwhile is kept as a version, not spread', async () => {
  const b = await box();
  try {
    await b.turnOn();
    await chooseTools(b.context, 'codex-cli', false);
    await writeFile(join(b.home, CODEX.skill), skillText('Edited in Codex while it was left out.'));
    await chooseTools(b.context, 'codex-cli', true);
    await b.pass();
    assert.deepEqual([await b.read('.claude/skills/notes/SKILL.md'), await b.read(CODEX.skill)], [skillText(), skillText()], 'the library wins in Codex, and nothing spread');
    assert.ok((await b.items()).skills.notes.versions.some(version => version.from.how === 'was-in' && version.from.harness === 'codex-cli'));
  } finally { await b.cleanup(); }
});

test('With Automatic sync off, as the card says: a click on an item brings that item into line in a tool turned on again, and Sync once the rest', async () => {
  const b = await box();
  try {
    await b.turnOn();
    await mkdir(join(b.home, '.claude/skills/todo'), { recursive: true });
    await writeFile(join(b.home, '.claude/skills/todo/SKILL.md'), '---\nname: todo\ndescription: Todo.\n---\n\nDo things.\n');
    await applySkills(b.context, await b.managed(), [{ key: 'todo', managed: true, off: [] }]);
    await chooseTools(b.context, 'codex-cli', false);
    await writeFile(join(b.home, CODEX.skill), skillText('Edited in Codex while it was left out.'));
    await chooseTools(b.context, 'codex-cli', true);
    // A click on todo, as the page sends it with Automatic sync off: a pass about todo alone.
    await applySkills(b.context, await b.managed(), [{ key: 'todo', managed: false, off: [], seenManaged: true }], { only: new Set(['todo']) });
    assert.deepEqual([await b.read('.codex/skills/todo/SKILL.md'), await b.read(CODEX.skill)], [undefined, skillText('Edited in Codex while it was left out.')], 'todo is brought into line there; notes waits');
    await b.pass();
    assert.equal(await b.read(CODEX.skill), skillText(), 'Sync once brings the rest');
  } finally { await b.cleanup(); }
});

test('Off, the item turned Off meanwhile, On: its copy in the tool goes then, and that content is a version', async () => {
  const b = await box();
  try {
    await b.turnOn();
    await chooseTools(b.context, 'codex-cli', false);
    const tools = await b.managed(), view = await skillsView(b.context, tools);
    await applySkills(b.context, tools, [{ key: 'notes', managed: false, off: [], seenManaged: true }]);
    assert.equal(await b.read(CODEX.skill), skillText(), 'an item turned Off stays in the tool left out until it is back');
    // Its row and the result say no tool Central Knot manages has it, not that no tool has it: Codex still does.
    const off = await skillsView(b.context, tools), row = off.items.find(fact => fact.key === 'notes')!, say = sentences(libraryWords.skills);
    const hashes = Object.fromEntries(Object.entries(row.copies).map(([tool, copy]) => [tool, copy!.hash]));
    assert.deepEqual([statusLine({ ...row, hashes }, off.library.notes, tools, false, ['codex-cli']), say.placeTag({ ...row, hashes }, off.library.notes, tools, ['codex-cli'])?.text, say.said.off('notes', [], tools, ['codex-cli'])],
      ['Off · in no tool Central Knot manages. Turn it on to put it in every tool.', 'in no tool Central Knot manages', 'notes is off: no tool Central Knot manages has it. Central Knot keeps it, and turning it on puts each folder back as it was.']);
    const { said, did } = await turnCodexOn(b);
    assert.deepEqual([said, did], [counts({ removed: 1 }), counts({ removed: 1 })]);
    assert.equal(await b.read(CODEX.skill), undefined);
    const item = (await b.items()).skills.notes;
    assert.ok(item.versions.some(version => version.hash === view.library.notes.hash), 'the content removed is the current version');
    assert.ok((await b.history()).some(event => event.key === 'notes' && event.kind === 'off' && event.losers.some(loser => loser.tool === 'codex-cli')), 'History says it left Codex');
  } finally { await b.cleanup(); }
});

test('Off, the copy deleted by hand in the tool, On: it is written again, and nothing turns Off', async () => {
  const b = await box();
  try {
    await b.turnOn();
    await chooseTools(b.context, 'codex-cli', false);
    await rm(join(b.home, '.codex/skills/notes'), { recursive: true });
    await b.pass();
    const { said, did } = await turnCodexOn(b);
    assert.deepEqual([said, did], [counts({ written: 1 }), counts({ written: 1 })]);
    assert.equal(await b.read(CODEX.skill), skillText());
    assert.equal((await b.items()).skills.notes.on, true);
  } finally { await b.cleanup(); }
});

test('An item deleted from Central Knot while a tool was left out: its copy there is counted as removed, not as found too, as the pass does', async () => {
  const b = await box();
  try {
    await b.turnOn();
    await chooseTools(b.context, 'codex-cli', false);
    await applySkills(b.context, await b.managed(), [{ key: 'notes', managed: true, off: [], deleted: true }]);
    const { said, did } = await turnCodexOn(b);
    assert.deepEqual([said, did], [counts({ removed: 1 }), counts({ removed: 1 })]);
  } finally { await b.cleanup(); }
});

test('A skill a tool left out has through a link is counted as found, and with Synchronize everything on as taken in, as the pass does', async () => {
  const b = await box();
  try {
    await b.turnOn();
    await chooseTools(b.context, 'codex-cli', false);
    await mkdir(join(b.home, 'depot/later'), { recursive: true });
    await writeFile(join(b.home, 'depot/later/SKILL.md'), '---\nname: later\ndescription: Later.\n---\n\nA linked skill.\n');
    await symlink(join(b.home, 'depot/later'), join(b.home, '.codex/skills/later'));
    assert.equal((await whatJoiningDoes(b.context, await b.managed(), 'codex-cli', false)).found, 1);
    await setSyncEverything(b.context, true);
    const { said, did } = await turnOnTool(b, 'codex-cli', true);
    assert.deepEqual([said, did], [counts({ takenIn: 1 }), counts({ takenIn: 1 })]);
  } finally { await b.cleanup(); }
});

test('OpenCode turned on while Claude Code is left out: a skill in Claude Code’s folder, which OpenCode reads, is counted as taken in, as the pass does', async () => {
  const b = await box({ opencode: true });
  try {
    await chooseTools(b.context, 'claude-cli', false);
    await chooseTools(b.context, 'opencode-cli', false);
    // Synchronize everything takes in what Copilot CLI and Codex have (docs) first; then notes and a new skill wait in Claude
    // Code's folder, which only OpenCode, once back, reads.
    await setSyncEverything(b.context, true);
    await b.pass();
    await mkdir(join(b.home, '.claude/skills/later'), { recursive: true });
    await writeFile(join(b.home, '.claude/skills/later/SKILL.md'), '---\nname: later\ndescription: Later.\n---\n\nLater.\n');
    const { said, did } = await turnOnTool(b, 'opencode-cli', true);
    assert.deepEqual([said, did], [counts({ written: 1, takenIn: 2 }), counts({ written: 1, takenIn: 2 })], 'docs written there; notes and later taken in');
  } finally { await b.cleanup(); }
});

test('A tool turned on counts a skill only it has as found, and with Synchronize everything on, as taken in, as the pass then does', async () => {
  const b = await box();
  try {
    await b.turnOn();
    await chooseTools(b.context, 'codex-cli', false);
    await mkdir(join(b.home, '.codex/skills/later'), { recursive: true });
    await writeFile(join(b.home, '.codex/skills/later/SKILL.md'), '---\nname: later\ndescription: Later.\n---\n\nLater.\n');
    const managed = await b.managed();
    assert.deepEqual([(await whatJoiningDoes(b.context, managed, 'codex-cli', false)).found, (await whatJoiningDoes(b.context, managed, 'codex-cli', true)).takenIn], [1, 1]);
    await setSyncEverything(b.context, true);
    await chooseTools(b.context, 'codex-cli', true);
    await b.pass();
    assert.equal((await b.items()).skills.later?.on, true, 'taken in by the rule');
    assert.equal(await b.read('.claude/skills/later/SKILL.md'), '---\nname: later\ndescription: Later.\n---\n\nLater.\n');
  } finally { await b.cleanup(); }
});

test('With a tool left out, nothing Central Knot does writes there: a skill turned On, a profile switch, Write to Claude Code, an instruction file, an Undo', async () => {
  const b = await box();
  try {
    await b.turnOn();
    await b.pass();
    await chooseTools(b.context, 'codex-cli', false);
    const codex = async () => Object.fromEntries(Object.entries((await b.toolFiles()).sha256).filter(([path]) => path.startsWith('.codex/')));
    const untouched = await codex();
    const tools = await b.managed();
    // A skill turned On: a found one, taken in by its Add.
    await mkdir(join(b.home, '.claude/skills/brief'), { recursive: true });
    await writeFile(join(b.home, '.claude/skills/brief/SKILL.md'), '---\nname: brief\ndescription: Brief.\n---\n\nBe brief.\n');
    const added = await applySkills(b.context, tools, [{ key: 'brief', managed: true, off: [] }]);
    assert.deepEqual(await codex(), untouched, 'a skill turned On');
    // An Undo of reviewer's Add, which put it in Codex: it leaves Central Knot again, Codex keeps its copy, and the result says so.
    const reviewerOn = (await b.history()).find(event => event.key === 'agent:reviewer' && event.kind === 'on')!;
    const undoReviewer = await restoreAgent(b.context, tools, reviewerOn.id);
    assert.equal(undoReviewer.stopped, undefined);
    assert.deepEqual(await codex(), untouched, 'an Undo of an entry that wrote Codex');
    const inCodex = undoReviewer.results.filter(result => result.harness === 'codex-cli');
    assert.deepEqual(inCodex.map(result => [result.outcome, result.message]), [['held', 'Codex isn’t managed here now, so this changed nothing there.']]);
    // A tool's own switch cleared, or a copy taken over: refused there.
    assert.match((await clearSwitch(b.context, tools, 'notes', 'codex-cli')).stopped ?? '', /^Codex isn’t managed here now\./);
    assert.match((await takeOver(b.context, tools, 'notes', 'codex-cli')).stopped ?? '', /^Codex isn’t managed here now\./);
    // A profile switch that turns notes Off and back.
    const made = await saveProfile(b.context, { name: 'Bare', items: [] });
    const switched = await switchProfile(b.context, tools, made.id!);
    assert.equal(switched.stopped, undefined);
    assert.deepEqual(await codex(), untouched, 'a profile switch');
    // Write to Claude Code, with docs owed there.
    await writeToClaude(b.context, tools, ['docs']);
    assert.deepEqual(await codex(), untouched, 'Write to Claude Code');
    // An instruction file: a save in Codex is refused, and the base goes to the managed tools only.
    await writeFile(join(b.home, '.codex/AGENTS.md'), 'Codex’s own.\n');
    const before = await codex();
    assert.match((await saveInstruction(b.context, await b.context.read(), 'codex-cli', 'Changed.\n', '')).stopped ?? '', /^Codex is left out of Central Knot here/);
    const files = await instructionsView(b.context, await b.context.read());
    assert.deepEqual(files.map(file => file.tool), ['claude-cli', 'copilot-cli'], 'Instructions shows only the managed tools');
    const seen = Object.fromEntries(files.map(file => [file.tool, { path: file.path, hash: file.hash }]));
    const base = await applyBase(b.context, await b.context.read(), { text: 'Be kind.\n', expected: (await baseView(b.context)).hash, tools: ['claude-cli', 'copilot-cli', 'codex-cli'], seen });
    assert.deepEqual(base.written.map(file => file.tool), ['claude-cli', 'copilot-cli']);
    assert.deepEqual(await codex(), before, 'an instruction file');
    // An Undo of brief's Add, made while Codex was left out: it touches only the managed tools, and names no other.
    const entry = (await b.history()).find(event => event.key === 'brief' && event.cause === 'found')!;
    assert.ok(added.made?.includes(entry.id));
    const undone = await restoreSkill(b.context, tools, entry.id);
    assert.deepEqual([await codex(), undone.results.filter(result => result.harness === 'codex-cli')], [before, []], 'an Undo');
    // The base's Undo leaves Codex's file as it is (it wrote nothing there) and says nothing about it.
    await undoBase(b.context, await b.context.read(), base.undo!);
    assert.deepEqual(await codex(), before);
  } finally { await b.cleanup(); }
});

test('A Pull with a tool left out brings the repo’s skill, MCP server and agent into the managed tools only', async () => {
  const repos = await world();
  try {
    const first = await repos.home('first');
    await skill(first, '.claude/skills', 'notes');
    await applySkillsIn(first, [{ key: 'notes', managed: true, off: [] }]);
    await seedServerAndAgent(first);
    await connectRepo(first, repos.remote, '');
    await pushRepo(first);
    const second = await repos.home('second', ['claude-cli', 'copilot-cli', 'codex-cli']);
    await chooseTools(second, 'codex-cli', false);
    await connectRepo(second, repos.remote, '');
    const pulled = await pullRepo(second);
    assert.equal(pulled.stopped, undefined);
    assert.equal(await readFile(join(second.home, '.claude/skills/notes/SKILL.md'), 'utf8'), repoSkill('notes'));
    assert.deepEqual(Object.keys((await filesIn(join(second.home, '.codex'))).sha256), [], 'nothing was written in Codex');
  } finally { await repos.cleanup(); }
});

test('What a pass removes or writes over that no click of it asked for has its History entry, whichever pass makes it', async () => {
  // Automatic sync off: Codex left out, notes turned Off, Codex back; an Undo of another skill's entry runs a pass about that
  // skill alone; then Sync once takes notes out of Codex.
  const b = await box();
  try {
    await b.turnOn();
    await mkdir(join(b.home, '.claude/skills/todo'), { recursive: true });
    await writeFile(join(b.home, '.claude/skills/todo/SKILL.md'), '---\nname: todo\ndescription: Todo.\n---\n\nDo things.\n');
    await applySkills(b.context, await b.managed(), [{ key: 'todo', managed: true, off: [] }]);
    const todoOn = (await b.history()).find(event => event.key === 'todo' && event.kind === 'on')!;
    await chooseTools(b.context, 'codex-cli', false);
    await applySkills(b.context, await b.managed(), [{ key: 'notes', managed: false, off: [], seenManaged: true }]);
    await chooseTools(b.context, 'codex-cli', true);
    await restoreSkill(b.context, await b.managed(), todoOn.id);
    assert.ok(await b.read(CODEX.skill), 'the Undo’s pass was about todo alone');
    await b.pass();
    assert.equal(await b.read(CODEX.skill), undefined);
    const removed = (await b.history()).filter(event => event.key === 'notes' && event.losers.some(loser => loser.tool === 'codex-cli'));
    assert.deepEqual(removed.map(event => [event.kind, event.cause]).at(-1), ['off', 'in-line']);
  } finally { await b.cleanup(); }
  // A tool back with an older version of an item that is On: written over, and said.
  const c = await box();
  try {
    await c.turnOn();
    await writeFile(join(c.home, '.claude/skills/notes/SKILL.md'), skillText('New notes.'));
    await c.pass();
    await chooseTools(c.context, 'codex-cli', false);
    await writeFile(join(c.home, CODEX.skill), skillText());
    const since = (await c.history()).length;
    await turnCodexOn(c);
    assert.equal(await c.read(CODEX.skill), skillText('New notes.'));
    const told = (await c.history()).slice(since).filter(event => event.key === 'notes');
    assert.deepEqual(told.map(event => [event.kind, event.cause, event.losers.map(loser => loser.tool)]), [['on', 'in-line', ['codex-cli']]]);
    const item = (await c.items()).skills.notes;
    assert.ok(item.versions.some(version => version.hash === told[0].losers[0].hash), 'what Codex held is one of its versions');
  } finally { await c.cleanup(); }
});

test('A copy of a deleted item removed from a tool managed again: its entry says it was deleted; the Delete’s entry keeps the Restore', async () => {
  const b = await box();
  try {
    await b.turnOn();
    await chooseTools(b.context, 'codex-cli', false);
    await applySkills(b.context, await b.managed(), [{ key: 'notes', managed: true, off: [], deleted: true }]);
    await turnCodexOn(b);
    const entry = (await b.history()).filter(event => event.key === 'notes').at(-1)!;
    const item = (await b.items()).skills.notes;
    assert.deepEqual([entry.kind, entry.cause, librarySentence(entry, libraryWords.skills, await b.managed(), item)?.text, libraryAction(entry, item)?.label],
      ['deleted', 'in-line', 'Deleted from Central Knot, so its folder in Codex was removed when sync reached it. History can restore it.', undefined]);
    const deletions = (await b.history()).filter(event => event.key === 'notes' && event.kind === 'deleted');
    assert.deepEqual(deletions.map(event => [event.cause, libraryAction(event, item)?.label]), [[undefined, 'Restore'], ['in-line', undefined]]);
  } finally { await b.cleanup(); }
});

test('A History Undo of a cleared switch writes nothing in a tool left out since: it is refused, in the words of the other Undos', async () => {
  const b = await box();
  try {
    await b.turnOn();
    const target = { folder: 'notes', name: 'notes', skillFile: join(b.home, CODEX.skill) };
    await setDisabled(b.context, 'codex-cli', target, true);
    assert.equal((await clearSwitch(b.context, await b.managed(), 'notes', 'codex-cli')).stopped, undefined);
    const cleared = (await b.history()).find(event => event.kind === 'switched')!;
    await chooseTools(b.context, 'codex-cli', false);
    const config = await b.read(CODEX.config);
    const undone = await restoreSkill(b.context, await b.managed(), cleared.id);
    assert.deepEqual([undone.stopped, await b.read(CODEX.config)], ['Codex isn’t managed here now, so this changed nothing there.', config]);
  } finally { await b.cleanup(); }
});

test('An instruction file that is the same file as a tool left out reads (a link) is not written: the save says why, and so does its card', async () => {
  const b = await box();
  try {
    await writeFile(join(b.home, '.codex/AGENTS.md'), 'Shared instructions.\n');
    await symlink('../.codex/AGENTS.md', join(b.home, '.claude/CLAUDE.md'));
    await chooseTools(b.context, 'codex-cli', false);
    const claude = (await instructionsView(b.context, await b.context.read())).find(file => file.tool === 'claude-cli')!;
    assert.ok(claude.notes.includes('This is the same file as Codex reads (a link), and Codex is left out of Central Knot here, so it can’t be saved from here.'), claude.notes.join(' | '));
    const saved = await saveInstruction(b.context, await b.context.read(), 'claude-cli', 'Changed via Claude Code.\n', claude.hash);
    assert.deepEqual([saved.stopped, await b.read('.codex/AGENTS.md')], ['CLAUDE.md is the same file as Codex reads (a link), and Codex is left out of Central Knot here, so nothing was saved.', 'Shared instructions.\n']);
    const seen = { 'claude-cli': { path: claude.path, hash: claude.hash } };
    const base = await applyBase(b.context, await b.context.read(), { text: 'Be kind.\n', expected: (await baseView(b.context)).hash, tools: ['claude-cli'], seen });
    assert.deepEqual([base.written, base.left, await b.read('.codex/AGENTS.md')], [[], [{ tool: 'claude-cli', why: 'left-out' }], 'Shared instructions.\n']);
  } finally { await b.cleanup(); }
});

test('A base written into a tool that is then left out: its Undo leaves that file as it is, and says why', async () => {
  const b = await box();
  try {
    await b.turnOn();
    const files = await instructionsView(b.context, await b.context.read());
    const seen = Object.fromEntries(files.map(file => [file.tool, { path: file.path, hash: file.hash }]));
    const base = await applyBase(b.context, await b.context.read(), { text: 'Be kind.\n', expected: (await baseView(b.context)).hash, tools: ['claude-cli', 'codex-cli'], seen });
    assert.deepEqual(base.written.map(file => file.tool), ['claude-cli', 'codex-cli']);
    await chooseTools(b.context, 'codex-cli', false);
    const codexFile = await b.read('.codex/AGENTS.md');
    const undone = await undoBase(b.context, await b.context.read(), base.undo!);
    assert.deepEqual([undone.written.map(file => file.tool), undone.left], [['claude-cli'], [{ tool: 'codex-cli', why: 'left-out' }]]);
    assert.equal(await b.read('.codex/AGENTS.md'), codexFile);
  } finally { await b.cleanup(); }
});

test('Turning a tool on or off is refused where a click would be: another build’s home; in a home waiting for Resume it resumes only when asked', async () => {
  const b = await box();
  try {
    await b.turnOn();
    // This app forgets the home (its settings file gone): the record is intact, and a click resumes.
    await rm(b.context.settingsPath);
    assert.equal((await syncGate(b.context)).state, 'needs-resume');
    assert.match((await chooseTools(b.context, 'codex-cli', false)).stopped ?? '', /no memory of it/);
    assert.deepEqual(await chooseTools(b.context, 'codex-cli', false, true), {});
    assert.deepEqual([(await syncGate(b.context)).state, await b.managed()], ['ready', ['claude-cli', 'copilot-cli']]);
    // Another build syncs the home: nothing changes.
    const other: ShareContext = { ...b.context, build: 'com.example.other', settingsPath: join(b.base, 'other.json') };
    assert.match((await chooseTools(other, 'codex-cli', true)).stopped ?? '', /syncs this home/);
    assert.deepEqual((await readRecord(b.home)).record?.leftOut, ['codex-cli']);
  } finally { await b.cleanup(); }
});

test('A tool left out stays left out when it is uninstalled and installed again; one installed later is managed by itself', async () => {
  const b = await box();
  try {
    await chooseTools(b.context, 'codex-cli', false);
    await rm(join(b.home, '.codex'), { recursive: true });
    assert.deepEqual(await b.managed(), ['claude-cli', 'copilot-cli']);
    await mkdir(join(b.home, '.codex'), { recursive: true });
    assert.deepEqual(await b.managed(), ['claude-cli', 'copilot-cli'], 'installed again, still left out');
    await mkdir(join(b.home, '.config/opencode'), { recursive: true });
    assert.deepEqual(await b.managed(), ['claude-cli', 'copilot-cli', 'opencode-cli'], 'a tool installed later is managed');
  } finally { await b.cleanup(); }
});

