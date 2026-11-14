// Sources, on real folders and made-up Git repositories standing in for links (tests/sourcerepo.ts: nothing reaches the
// network): the owner's example first, then each row of the source's table (library.ts A SOURCE) and each way it goes wrong,
// one worked example each. The table itself, row by row, is in tests/library.test.ts.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmod, mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pruneHistory, readHistory } from '../src/history.ts';
import { doneWords, libraryAction, librarySentence } from '../src/historyactions.ts';
import { asItIs, fromSourceWords, libraryWords } from '../src/libraryrow.ts';
import { DAY_MS } from '../src/model.ts';
import { addSource, checkDue, checkSource, previewSource, removeSource, rowClick, SOURCE_CHECK_EVERY_MS, sourcesView } from '../src/sources.ts';
import { chooseTools } from '../src/toolchoice.ts';
import type { SourcePreview } from '../src/types.ts';
import { bytes, everywhere, folderOf, historyActions, itemOf, put, sandbox, seen, skillText, type Box } from './skillclicks.ts';
import { applySkills, restoreSkill } from '../src/skills.ts';
import { deslopFiles, repository, skillMd, standInHosts } from './sourcerepo.ts';

const hosts = await standInHosts();
test.after(() => hosts.cleanup());

const DESLOP = 'https://github.com/stephenturner/skill-deslop/tree/main';
const now = (box: Box) => async () => box.tools;
const inTurn = <T>(work: () => Promise<T>) => work();
/** Looks at a link, then adds it: what the page's Look then Add do. */
async function add(box: Box, link: string) {
  const look = await previewSource(box.context, box.tools, link);
  assert.ok('token' in look && !look.refused, `the look is refused: ${look.refused}`);
  return { look, added: await addSource(box.context, box.tools, look.token) };
}
const check = (box: Box, id: string) => checkSource(box.context, now(box), id, inTurn);
/** What a click did to each item, by name (the History entry each names is left out). */
const answered = (result: { sourced?: { name: string; answer: string }[] }) => result.sourced?.map(({ name, answer }) => ({ name, answer }));
const sourceId = async (box: Box) => (await sourcesView(box.context, box.tools)).sources[0].id;
const sentences = async (box: Box, key = 'deslop') => {
  const item = await itemOf(box, key);
  return (await readHistory(box.context)).filter(event => event.key === key).map(event => librarySentence(event, libraryWords.skills, box.tools, item)?.text);
};

test('The owner’s example: a link to a repository whose root is one skill offers deslop with every file beside its SKILL.md; Add puts it in Central Knot, Off; On gives every tool all of it, byte for byte', async () => {
  const repo = await repository(hosts, 'https://github.com/stephenturner/skill-deslop');
  await repo.commit(deslopFiles(), '2026-11-01T10:00:00Z');
  const box = await sandbox();
  try {
    const look = await previewSource(box.context, box.tools, DESLOP) as Extract<SourcePreview, { token: string }>;
    assert.equal(look.refused, undefined);
    assert.deepEqual([look.holds, look.ref, look.folder], ['items', 'main', '']);
    assert.deepEqual(look.names.map(name => [name.name, name.there?.folder, name.there?.folderName, name.state]), [['deslop', '', 'skill-deslop', 'make']], 'named as its SKILL.md names it, at the root of skill-deslop');
    assert.deepEqual(look.names[0].there?.files, ['.gitignore', 'LICENSE', 'README.md', 'SKILL.md', 'references/checklist.md', 'references/examples.md', 'references/phrases.md', 'references/structures.md']);
    assert.deepEqual(await everywhere(box, 'deslop'), { 'claude-cli': undefined, 'copilot-cli': undefined, 'codex-cli': undefined, 'opencode-cli': undefined, 'pi-cli': undefined }, 'a look writes no tool');
    assert.equal(await itemOf(box, 'deslop'), undefined, 'and keeps nothing in the library');

    const added = await addSource(box.context, box.tools, look.token);
    assert.equal(added.stopped, undefined);
    assert.deepEqual(answered(added), [{ name: 'deslop', answer: 'make' }]);
    const item = (await itemOf(box, 'deslop'))!;
    assert.deepEqual([item.on, item.versions.map(version => [version.from.how, version.from.link, version.at])], [false, [['source', DESLOP, '2026-11-01T10:00:00.000Z']]]);
    assert.deepEqual(Object.values(await everywhere(box, 'deslop')).filter(Boolean), [], 'Off: in no tool');
    assert.deepEqual(await sentences(box), ['Brought in from github.com/stephenturner/skill-deslop (main): in Central Knot, Off, until you turn it on.']);
    const view = (await sourcesView(box.context, box.tools)).sources[0];
    assert.deepEqual([view.link, view.names.map(name => [name.name, name.state, name.on])], [DESLOP, [['deslop', 'nothing', false]]]);
    assert.deepEqual((await seen(box, box.context, 'deslop')).fact?.fromSource, { link: DESLOP }, 'its row on Skills says where it is from');

    const { row } = await seen(box, box.context, 'deslop');
    await applySkills(box.context, box.tools, [{ key: 'deslop', on: true, except: [], seenOn: false }]);
    const source = await bytes(repo.dir).then(files => Object.fromEntries(Object.entries(files!).filter(([path]) => !path.startsWith('.git/') && path !== '.git/')));
    for (const tool of box.tools) assert.deepEqual(await bytes(folderOf(box, tool as never, 'deslop')), source, `${tool} has every file, byte for byte`);
    assert.ok(row);
  } finally { await box.cleanup(); }
});

// ---------- Each row of the table, on real files ----------

/** A repository at github.com/team/<name> holding one skill named `skill` at its root, and that link added; the item On when `on`. */
async function oneSkill(box: Box, name: string, { skill = name, body = 'First.', when = '2026-11-01T10:00:00Z', on = false } = {}) {
  const repo = await repository(hosts, `https://github.com/team/${name}`);
  await repo.commit({ 'SKILL.md': skillMd(skill, body) }, when);
  const link = `https://github.com/team/${name}`;
  const { added } = await add(box, link);
  assert.equal(added.stopped, undefined);
  if (on) await applySkills(box.context, box.tools, [{ key: skill, on: true, except: [], seenOn: false }]);
  return { repo, link, id: (await sourcesView(box.context, box.tools)).sources.find(source => source.link === link)!.id };
}
const bodyOf = async (box: Box, key: string) => { const item = (await itemOf(box, key))!; return (await readFile(join(box.home, '.central-knot/items/skills', key, 'versions', item.hash, 'SKILL.md'), 'utf8')).trim().split('\n').at(-1); };
const toolBody = async (box: Box, tool: string, key: string) => (await readFile(join(folderOf(box, tool as never, key), 'SKILL.md'), 'utf8').catch(() => undefined))?.trim().split('\n').at(-1);

test('S = seen: Check now with nothing new at the source changes nothing, and tells History nothing', async () => {
  const box = await sandbox();
  try {
    const { id } = await oneSkill(box, 'notes');
    const before = [await itemOf(box, 'notes'), (await readHistory(box.context)).length];
    const done = await check(box, id);
    assert.deepEqual([done.stopped, answered(done)], [undefined, []]);
    assert.deepEqual([await itemOf(box, 'notes'), (await readHistory(box.context)).length], before);
  } finally { await box.cleanup(); }
});

test('S changed, current = seen: the source’s content becomes current, Off stays Off and no tool is written; its entry’s Undo makes the one before current again', async () => {
  const box = await sandbox();
  try {
    const { repo, id } = await oneSkill(box, 'notes');
    await repo.commit({ 'SKILL.md': skillMd('notes', 'Second.') }, '2026-11-02T10:00:00Z');
    const done = await check(box, id);
    assert.deepEqual(answered(done), [{ name: 'notes', answer: 'update' }]);
    const item = (await itemOf(box, 'notes'))!;
    assert.deepEqual([item.on, await bodyOf(box, 'notes'), item.versions.map(version => version.at)], [false, 'Second.', ['2026-11-02T10:00:00.000Z', '2026-11-01T10:00:00.000Z']]);
    assert.deepEqual(Object.values(await everywhere(box)).filter(Boolean), []);
    assert.equal((await sentences(box, 'notes')).at(-1), 'Updated from github.com/team/notes; that became the current version.');
    const entry = (await readHistory(box.context)).at(-1)!;
    const undo = libraryAction(entry, item, { managed: box.tools, pending: [] })!;
    assert.equal(undo.label, 'Undo');
    await applySkills(box.context, box.tools, [undo.change]);
    assert.equal(await bodyOf(box, 'notes'), 'First.');
    assert.deepEqual(answered(await check(box, id)), [], 'the source has not changed since, so the next check leaves the Undo as it is');
  } finally { await box.cleanup(); }
});

test('S changed while On: every tool gets the source’s content', async () => {
  const box = await sandbox();
  try {
    const { repo, id } = await oneSkill(box, 'notes', { on: true });
    await repo.commit({ 'SKILL.md': skillMd('notes', 'Second.') }, '2026-11-02T10:00:00Z');
    await check(box, id);
    for (const tool of box.tools) assert.equal(await toolBody(box, tool, 'notes'), 'Second.');
    assert.equal((await sentences(box, 'notes')).at(-1), 'Updated from github.com/team/notes; that became the current version, in all 3 tools.');
  } finally { await box.cleanup(); }
});

/** An edit made in Claude Code at `when` and taken in by a pass: the current version, no longer what the source last had. */
async function editHere(box: Box, key: string, body: string, when = '2026-11-03T10:00:00Z') {
  await editIn(box, 'claude-cli', key, body, when);
  await applySkills(box.context, box.tools, []);
}
/** An edit made in one tool at `when`, which no pass has taken in yet (Automatic sync off). */
async function editIn(box: Box, tool: 'claude-cli' | 'codex-cli', key: string, body: string, when: string) {
  const folder = folderOf(box, tool, key);
  await put(box, tool, { 'SKILL.md': skillMd(key, body) }, [], key);
  const { utimes } = await import('node:fs/promises');
  for (const path of [join(folder, 'SKILL.md'), folder]) await utimes(path, new Date(when), new Date(when));
}
/** What a skill is to its source on the Sources page, and on its row on Skills. */
const notices = async (box: Box, key: string) => [(await sourcesView(box.context, box.tools)).sources[0].names.find(name => name.key === key)?.state, (await seen(box, box.context, key)).fact?.fromSource?.waits ?? false];
const replace = (box: Box, id: string, key: string) => rowClick(box.context, box.tools, id, 'skill', key, 'replace');

test('Changed here, then the source changes: its version waits, whatever the times say; the edit stays current in Central Knot and every tool, both rows say so, and nothing is stored', async () => {
  const box = await sandbox();
  try {
    const { repo, id } = await oneSkill(box, 'notes', { on: true });
    // The edit here is a day older than the source's change, which a clock would have let win.
    await editHere(box, 'notes', 'Mine.', '2026-11-03T10:00:00Z');
    await repo.commit({ 'SKILL.md': skillMd('notes', 'Theirs.') }, '2026-11-04T10:00:00Z');
    const before = { item: await itemOf(box, 'notes'), history: (await readHistory(box.context)).length };
    const done = await check(box, id);
    assert.deepEqual(answered(done), [{ name: 'notes', answer: 'wait' }]);
    for (const tool of box.tools) assert.equal(await toolBody(box, tool, 'notes'), 'Mine.');
    assert.deepEqual([await itemOf(box, 'notes'), (await readHistory(box.context)).length], [before.item, before.history], 'no version, no `seen` moved, no entry');
    assert.deepEqual(await notices(box, 'notes'), ['wait', true]);
    assert.deepEqual(answered(await check(box, id)), [{ name: 'notes', answer: 'wait' }], 'the next check, the daily one too, leaves it waiting');
  } finally { await box.cleanup(); }
});

test('Check now says a version waits only where the source’s row still says so after the pass: a tool managed again whose copy gives way (Automatic sync off), and the source’s own text pasted into a tool', async () => {
  const box = await sandbox();
  try {
    // Codex left out, edited there meanwhile, managed again with no pass before the check: the pass gives Codex's copy way.
    const { repo, id } = await oneSkill(box, 'notes', { on: true });
    await chooseTools(box.context, 'codex-cli', false);
    await editIn(box, 'codex-cli', 'notes', 'Edited in Codex while left out.', '2026-11-05T10:00:00Z');
    await repo.commit({ 'SKILL.md': skillMd('notes', 'Theirs.') }, '2026-11-06T10:00:00Z');
    await chooseTools(box.context, 'codex-cli', true);
    const done = await check(box, id);
    assert.deepEqual([answered(done), await notices(box, 'notes')], [[], ['update', false]], 'nothing waits, so the band says no Replace');
    assert.deepEqual(answered(await check(box, id)), [{ name: 'notes', answer: 'update' }]);

    // The source's new text pasted into Codex by hand: taken in, it is the source's own, so nothing waits.
    await repo.commit({ 'SKILL.md': skillMd('notes', 'Theirs, pasted.') }, '2026-11-07T10:00:00Z');
    await editIn(box, 'codex-cli', 'notes', 'Theirs, pasted.', '2026-11-08T10:00:00Z');
    const pasted = await check(box, id);
    assert.deepEqual([answered(pasted), await notices(box, 'notes')], [[], ['same', false]]);
  } finally { await box.cleanup(); }
});

test('Replace: the source’s version becomes current in every tool, the edit is kept as a version and History says so; then the item follows its source again', async () => {
  const box = await sandbox();
  try {
    const { repo, id } = await oneSkill(box, 'notes', { on: true });
    await editHere(box, 'notes', 'Mine.');
    await repo.commit({ 'SKILL.md': skillMd('notes', 'Theirs.') }, '2026-11-04T10:00:00Z');
    await check(box, id);
    const done = await replace(box, id, 'notes');
    assert.deepEqual(answered(done), [{ name: 'notes', answer: 'update' }]);
    assert.equal(await bodyOf(box, 'notes'), 'Theirs.');
    for (const tool of box.tools) assert.equal(await toolBody(box, tool, 'notes'), 'Theirs.');
    assert.ok((await itemOf(box, 'notes'))!.versions.some(version => version.from.how === 'edited'), 'the edit is a version');
    assert.equal((await sentences(box, 'notes')).at(-1), 'Replaced with github.com/team/notes’s version; that became the current version, in all 3 tools. The version it replaced is kept.');
    assert.equal(done.sourced?.[0].history, (await readHistory(box.context)).at(-1)!.id, 'the answer names its entry, whose Undo the band offers');
    assert.deepEqual(await notices(box, 'notes'), ['nothing', false]);
    await repo.commit({ 'SKILL.md': skillMd('notes', 'Theirs again.') }, '2026-11-05T10:00:00Z');
    assert.deepEqual(answered(await check(box, id)), [{ name: 'notes', answer: 'update' }], 'unchanged here since, it follows by itself');
    for (const tool of box.tools) assert.equal(await toolBody(box, tool, 'notes'), 'Theirs again.');
  } finally { await box.cleanup(); }
});

test('Undo of a Replace over an edit made here: the edit is current again in every tool, and the source’s version waits again; the next check doesn’t take it', async () => {
  const box = await sandbox();
  try {
    const { repo, id } = await oneSkill(box, 'notes', { on: true });
    await editHere(box, 'notes', 'Mine.');
    await repo.commit({ 'SKILL.md': skillMd('notes', 'Theirs.') }, '2026-11-04T10:00:00Z');
    await check(box, id);
    await replace(box, id, 'notes');
    const entry = (await readHistory(box.context)).at(-1)!, item = (await itemOf(box, 'notes'))!;
    const undo = libraryAction(entry, item, { managed: box.tools, pending: [] })!;
    assert.deepEqual([undo.label, undo.help], ['Undo', 'Make the version from before this change current again, in every tool it is on in']);
    await restoreSkill(box.context, box.tools, entry.id);
    for (const tool of box.tools) assert.equal(await toolBody(box, tool, 'notes'), 'Mine.');
    assert.deepEqual(await notices(box, 'notes'), ['wait', true]);
    assert.deepEqual(answered(await check(box, id)), [{ name: 'notes', answer: 'wait' }]);
    assert.equal(await bodyOf(box, 'notes'), 'Mine.');
  } finally { await box.cleanup(); }
});

test('An edit in a tool that no pass has taken in (Automatic sync off), then Check now: the edit is taken in first and the source’s version waits; it is never written over', async () => {
  const box = await sandbox();
  try {
    const { repo, id } = await oneSkill(box, 'notes', { on: true });
    // Older than the source's change: by time, the source would have won.
    await editIn(box, 'codex-cli', 'notes', 'Edited in Codex.', '2026-11-06T10:00:00Z');
    await repo.commit({ 'SKILL.md': skillMd('notes', 'From the source.') }, '2026-11-07T10:00:00Z');
    const done = await check(box, id);
    assert.deepEqual([answered(done), await bodyOf(box, 'notes')], [[{ name: 'notes', answer: 'wait' }], 'Edited in Codex.']);
    for (const tool of box.tools) assert.equal(await toolBody(box, tool, 'notes'), 'Edited in Codex.');
    assert.deepEqual((await readHistory(box.context)).filter(event => event.key === 'notes').slice(-1).map(event => [event.kind, event.winner?.tool]), [['edit', 'codex-cli']]);
    assert.deepEqual(await notices(box, 'notes'), ['wait', true]);
  } finally { await box.cleanup(); }
});

test('A tool’s edit still settling when the check runs (its copy moved away by the editor’s save): the source’s version waits, and the edit, once back, is taken in with no clock deciding', async () => {
  const box = await sandbox();
  try {
    const { repo, id } = await oneSkill(box, 'notes', { on: true });
    await repo.commit({ 'SKILL.md': skillMd('notes', 'From the source.') }, '2026-11-07T10:00:00Z');
    await rm(folderOf(box, 'codex-cli', 'notes'), { recursive: true });
    const settling = { ...box.context, settleMs: 60_000 };
    // The pass waits; the page's look reads the settle window as passed, so its row (and so the click's band) says no wait.
    assert.deepEqual(answered(await checkSource(settling, now(box), id, inTurn)), []);
    assert.equal(await bodyOf(box, 'notes'), 'First.', 'the source’s version waited');
    // The save lands, older than the source's commit.
    await editIn(box, 'codex-cli', 'notes', 'Saved in Codex.', '2026-11-06T10:00:00Z');
    await applySkills(settling, box.tools, []);
    assert.equal(await bodyOf(box, 'notes'), 'Saved in Codex.');
    for (const tool of box.tools) assert.equal(await toolBody(box, tool, 'notes'), 'Saved in Codex.');
    assert.deepEqual(answered(await check(box, id)), [{ name: 'notes', answer: 'wait' }]);
  } finally { await box.cleanup(); }
});

test('Replace while a tool holds an edit no pass has taken in (Automatic sync off): Replace comes after that edit, so the source’s version is current in every tool and the edit is kept as a version', async () => {
  const box = await sandbox();
  try {
    const { repo, id } = await oneSkill(box, 'notes', { on: true });
    await editHere(box, 'notes', 'Mine.');
    await repo.commit({ 'SKILL.md': skillMd('notes', 'Theirs.') }, '2026-11-04T10:00:00Z');
    await check(box, id);
    // Saved in Codex after the source's commit, before the click.
    await editIn(box, 'codex-cli', 'notes', 'Mine, again in Codex.', '2026-11-05T10:00:00Z');
    assert.deepEqual(answered(await replace(box, id, 'notes')), [{ name: 'notes', answer: 'update' }]);
    assert.equal(await bodyOf(box, 'notes'), 'Theirs.');
    for (const tool of box.tools) assert.equal(await toolBody(box, tool, 'notes'), 'Theirs.');
    const kept = (await itemOf(box, 'notes'))!.versions.filter(version => version.from.how === 'edited').map(version => version.from.harness);
    assert.deepEqual(kept.sort(), ['claude-cli', 'codex-cli']);
  } finally { await box.cleanup(); }
});

test('A copy that can’t be read where the skill is applied: the source’s change waits, and both rows say so before any check, until it can be read; Replace still takes it, and the copy gets it once readable', async () => {
  const box = await sandbox();
  try {
    const { repo, id } = await oneSkill(box, 'notes', { on: true });
    const codex = join(folderOf(box, 'codex-cli', 'notes'), 'SKILL.md'), asWritten = await readFile(codex, 'utf8');
    await repo.commit({ 'SKILL.md': skillMd('notes', 'Theirs.') }, '2026-11-04T10:00:00Z');
    await writeFile(codex, '---\nname: [notes\n---\nHalf saved.\n');
    assert.deepEqual(answered(await check(box, id)), [{ name: 'notes', answer: 'wait' }]);
    assert.deepEqual(await notices(box, 'notes'), ['wait', true], 'the page reads the tools as the pass does');
    // Nothing was changed here: its words say it waits for either reason, and claim neither.
    assert.equal(fromSourceWords((await seen(box, box.context, 'notes')).fact!.fromSource!).before,
      'From github.com/team/notes, a source, which has a newer version. Yours stays current, since it was changed here or a tool’s copy of it can’t be read just now. On ');
    const replaced = await replace(box, id, 'notes');
    assert.deepEqual([await toolBody(box, 'claude-cli', 'notes'), await toolBody(box, 'codex-cli', 'notes')], ['Theirs.', 'Half saved.']);
    await writeFile(codex, asWritten);
    await applySkills(box.context, box.tools, []);
    assert.equal(await toolBody(box, 'codex-cli', 'notes'), 'Theirs.');
    // Its Undo promises only the version before: nothing was changed here, so once undone the item follows its source again.
    const entry = (await readHistory(box.context)).find(event => event.id === replaced.sourced?.[0].history)!;
    assert.equal(libraryAction(entry, (await itemOf(box, 'notes'))!, { managed: box.tools, pending: [] })!.help, 'Make the version from before this change current again, in every tool it is on in');
    await restoreSkill(box.context, box.tools, entry.id);
    assert.deepEqual(answered(await check(box, id)), [{ name: 'notes', answer: 'update' }]);
  } finally { await box.cleanup(); }
});

// ---------- Merge (library.ts MERGE), on real folders with this computer's git ----------

/** A SKILL.md body of three lines apart, so a change to the first and one to the last merge line by line. */
const lines = (first = 'First.', last = 'Last.') => `${first}\n\nThe middle.\n\n${last}`;
const mergeIt = (box: Box, id: string, key = 'notes') => rowClick(box.context, box.tools, id, 'skill', key, 'merge');
/** What a click did to each item, with what Merge did. */
const merged = (result: { sourced?: { name: string; answer: string; merge?: unknown }[] }) => result.sourced?.map(({ name, answer, merge }) => ({ name, answer, ...(merge ? { merge } : {}) }));
/** Each managed tool's SKILL.md of the skill. */
const toolTexts = async (box: Box, key = 'notes') => Promise.all(box.tools.map(tool => readFile(join(folderOf(box, tool as never, key), 'SKILL.md'), 'utf8').catch(() => undefined)));
/** A skill changed here in its first line, whose source then changed its last: its version waits. */
async function waitingToMerge(box: Box, theirs = lines('First.', 'Last, theirs.')) {
  const { repo, id, link } = await oneSkill(box, 'notes', { on: true, body: lines() });
  await editHere(box, 'notes', lines('First, mine.'));
  await repo.commit({ 'SKILL.md': skillMd('notes', theirs) }, '2026-11-04T10:00:00Z');
  assert.deepEqual(answered(await check(box, id)), [{ name: 'notes', answer: 'wait' }]);
  return { repo, id, link, mine: (await itemOf(box, 'notes'))!.hash };
}

test('Merge: a change here and the source’s, in lines apart, become the current version in Central Knot and every tool; yours and the source’s stay among its versions, History says so, and its row says it is still changed here', async () => {
  const box = await sandbox();
  try {
    const { id, link, mine } = await waitingToMerge(box);
    const clicked = Date.now(), done = await mergeIt(box, id);
    assert.deepEqual(merged(done), [{ name: 'notes', answer: 'merge', merge: 'merged' }]);
    assert.deepEqual(await toolTexts(box), box.tools.map(() => skillMd('notes', lines('First, mine.', 'Last, theirs.'))));
    const item = (await itemOf(box, 'notes'))!, source = item.versions.find(version => version.from.how === 'source' && version.from.replacedBy === item.hash);
    assert.deepEqual(item.versions[0].from, { how: 'merged', link });
    assert.ok(Date.parse(item.versions[0].at) >= clicked - 1000, 'dated by the click, not by the source’s commit');
    assert.ok(item.versions.some(version => version.hash === mine), 'yours is a version');
    assert.equal(item.seen, source?.hash, 'the source’s version is kept, and is what it last took');
    assert.equal((await sentences(box, 'notes')).at(-1), 'Merged github.com/team/notes’s version into yours; that became the current version, in all 3 tools. The version it had and the source’s are kept.');
    assert.equal(done.sourced?.[0].history, (await readHistory(box.context)).at(-1)!.id, 'the answer names its entry, whose Undo the band offers');
    assert.deepEqual(await notices(box, 'notes'), ['nothing', false]);
    const from = (await seen(box, box.context, 'notes')).fact!.fromSource!;
    assert.deepEqual(from, { link, nextWaits: true });
    assert.equal(fromSourceWords(from).before, 'From github.com/team/notes, a source. You changed it here, or a tool’s copy of it can’t be read just now, so the source’s next change will wait for you to Merge, Replace or Keep mine on ');
  } finally { await box.cleanup(); }
});

test('Merge with a conflict changes nothing: no version, no tool written, no History entry, `seen` where it was and nothing of the merge left; its answer names the file, and the version still waits', async () => {
  const box = await sandbox();
  try {
    const { id } = await waitingToMerge(box, lines('First, theirs.'));
    const before = { item: await itemOf(box, 'notes'), history: (await readHistory(box.context)).length, tools: await everywhere(box) };
    const done = await mergeIt(box, id);
    assert.deepEqual(merged(done), [{ name: 'notes', answer: 'merge', merge: { conflicts: ['SKILL.md'] } }]);
    assert.deepEqual({ item: await itemOf(box, 'notes'), history: (await readHistory(box.context)).length, tools: await everywhere(box) }, before);
    assert.deepEqual((await readdir(join(box.home, '.central-knot'))).filter(name => name.startsWith('merging-')), []);
    assert.deepEqual(await notices(box, 'notes'), ['wait', true]);
  } finally { await box.cleanup(); }
});

test('Merge on real folders never loses a side: a script made runnable here and a file added here survive the source’s change; a file deleted here that the source changed is a conflict, not a deletion', async () => {
  const box = await sandbox();
  try {
    const { repo, id } = await oneSkill(box, 'notes', { on: true, body: lines() });
    await repo.commit({ 'SKILL.md': skillMd('notes', lines()), 'run.sh': '#!/bin/sh\necho one\n', 'notes.md': 'Notes.\n' }, '2026-11-02T10:00:00Z');
    await check(box, id);
    const claude = folderOf(box, 'claude-cli', 'notes');
    await chmod(join(claude, 'run.sh'), 0o755);
    await writeFile(join(claude, 'mine.md'), 'Mine.\n');
    await applySkills(box.context, box.tools, []);
    await repo.commit({ 'SKILL.md': skillMd('notes', lines('First.', 'Last, theirs.')) }, '2026-11-03T10:00:00Z');
    await check(box, id);
    assert.deepEqual(merged(await mergeIt(box, id)), [{ name: 'notes', answer: 'merge', merge: 'merged' }]);
    for (const tool of box.tools) {
      const folder = folderOf(box, tool as never, 'notes');
      assert.deepEqual([(await stat(join(folder, 'run.sh'))).mode & 0o111, await readFile(join(folder, 'mine.md'), 'utf8'), await toolBody(box, tool, 'notes')], [0o111, 'Mine.\n', 'Last, theirs.']);
    }
    await rm(join(claude, 'notes.md'));
    await applySkills(box.context, box.tools, []);
    await repo.commit({ 'notes.md': 'Notes, changed at the source.\n' }, '2026-11-04T10:00:00Z');
    await check(box, id);
    assert.deepEqual(merged(await mergeIt(box, id)), [{ name: 'notes', answer: 'merge', merge: { conflicts: ['notes.md'] } }]);
  } finally { await box.cleanup(); }
});

test('Undo of a Merge: yours is current again in every tool, and the source’s version waits again; the next check doesn’t take it', async () => {
  const box = await sandbox();
  try {
    const { id } = await waitingToMerge(box);
    await mergeIt(box, id);
    const entry = (await readHistory(box.context)).at(-1)!;
    const undo = libraryAction(entry, (await itemOf(box, 'notes'))!, { managed: box.tools, pending: [] })!;
    assert.deepEqual([undo.label, undo.change.seen !== undefined], ['Undo', true]);
    await restoreSkill(box.context, box.tools, entry.id);
    assert.deepEqual(await toolTexts(box), box.tools.map(() => skillMd('notes', lines('First, mine.'))));
    assert.deepEqual(await notices(box, 'notes'), ['wait', true]);
    assert.deepEqual(answered(await check(box, id)), [{ name: 'notes', answer: 'wait' }]);
  } finally { await box.cleanup(); }
});

test('Merge, its Undo, then the Undo of that Undo: the merged version is current again, and the source’s version it took no longer waits', async () => {
  const box = await sandbox();
  try {
    const { id } = await waitingToMerge(box);
    await mergeIt(box, id);
    await restoreSkill(box.context, box.tools, (await readHistory(box.context)).at(-1)!.id);
    assert.deepEqual(await notices(box, 'notes'), ['wait', true]);
    await restoreSkill(box.context, box.tools, (await readHistory(box.context)).at(-1)!.id);
    assert.deepEqual(await toolTexts(box), box.tools.map(() => skillMd('notes', lines('First, mine.', 'Last, theirs.'))));
    assert.deepEqual(await notices(box, 'notes'), ['nothing', false]);
  } finally { await box.cleanup(); }
});

test('After a Merge nothing is stuck or written over: the source’s next change waits, with the version merged in as the base, so a second Merge takes it; edited back to exactly the source’s text it follows again; Replace after a Merge takes the source’s', async () => {
  const box = await sandbox();
  try {
    const { repo, id } = await waitingToMerge(box);
    await mergeIt(box, id);
    // The source changes its last line again. Against the first base this would clash with the merged last line; against the
    // version merged in, only the source changed it.
    await repo.commit({ 'SKILL.md': skillMd('notes', lines('First.', 'Last, theirs again.')) }, '2026-11-05T10:00:00Z');
    assert.deepEqual(answered(await check(box, id)), [{ name: 'notes', answer: 'wait' }]);
    assert.deepEqual(merged(await mergeIt(box, id)), [{ name: 'notes', answer: 'merge', merge: 'merged' }]);
    assert.deepEqual(await toolTexts(box), box.tools.map(() => skillMd('notes', lines('First, mine.', 'Last, theirs again.'))));
    // Edited back by hand to exactly the source's text: it follows the next change by itself.
    await editHere(box, 'notes', lines('First.', 'Last, theirs again.'), '2026-11-06T10:00:00Z');
    await repo.commit({ 'SKILL.md': skillMd('notes', lines('First.', 'Last, the third.')) }, '2026-11-07T10:00:00Z');
    assert.deepEqual(answered(await check(box, id)), [{ name: 'notes', answer: 'update' }]);
    // Changed here and merged once more; then Replace takes the source's next change as it is.
    await editHere(box, 'notes', lines('First, mine again.', 'Last, the third.'), '2026-11-08T10:00:00Z');
    await repo.commit({ 'SKILL.md': skillMd('notes', lines('First.', 'Last, the fourth.')) }, '2026-11-09T10:00:00Z');
    await check(box, id);
    await mergeIt(box, id);
    await repo.commit({ 'SKILL.md': skillMd('notes', lines('First.', 'Last, the fifth.')) }, '2026-11-10T10:00:00Z');
    assert.deepEqual(answered(await check(box, id)), [{ name: 'notes', answer: 'wait' }]);
    assert.deepEqual(answered(await replace(box, id, 'notes')), [{ name: 'notes', answer: 'update' }]);
    assert.deepEqual(await toolTexts(box), box.tools.map(() => skillMd('notes', lines('First.', 'Last, the fifth.'))));
  } finally { await box.cleanup(); }
});

test('Merged to exactly yours (the source made a change you had made too): Keep mine’s outcome, with its one entry and no tool written; merged to exactly the source’s, it follows its source again', async () => {
  const box = await sandbox();
  try {
    const { repo, id } = await oneSkill(box, 'notes', { on: true, body: lines() });
    await editHere(box, 'notes', lines('First, mine.', 'Last, both.'));
    await repo.commit({ 'SKILL.md': skillMd('notes', lines('First.', 'Last, both.')) }, '2026-11-04T10:00:00Z');
    await check(box, id);
    const entries = (await readHistory(box.context)).length, current = (await itemOf(box, 'notes'))!.hash, inTools = await toolTexts(box);
    assert.deepEqual(merged(await mergeIt(box, id)), [{ name: 'notes', answer: 'merge', merge: 'had' }]);
    assert.deepEqual([(await itemOf(box, 'notes'))!.hash, (await readHistory(box.context)).length, await notices(box, 'notes'), await toolTexts(box)], [current, entries + 1, ['nothing', false], inTools]);
    assert.equal((await sentences(box, 'notes')).at(-1), 'Yours stays current over github.com/team/notes’s version, which no longer waits: it is kept as a version, and the source’s next change is compared with it.');
    // Now the source takes your first line too, and changes its middle: yours is in the source's, so the merge is the source's.
    const theirs = lines('First, mine.', 'Last, both.').replace('The middle.', 'The middle, theirs.');
    await repo.commit({ 'SKILL.md': skillMd('notes', theirs) }, '2026-11-05T10:00:00Z');
    assert.deepEqual(answered(await check(box, id)), [{ name: 'notes', answer: 'wait' }]);
    assert.deepEqual(merged(await mergeIt(box, id)), [{ name: 'notes', answer: 'merge', merge: 'merged' }]);
    assert.deepEqual(await toolTexts(box), box.tools.map(() => skillMd('notes', theirs)));
    await repo.commit({ 'SKILL.md': skillMd('notes', theirs.replace('Last, both.', 'Last, the source’s alone.')) }, '2026-11-07T10:00:00Z');
    assert.deepEqual(answered(await check(box, id)), [{ name: 'notes', answer: 'update' }], 'at the source’s text, it follows by itself');
  } finally { await box.cleanup(); }
});

test('Merge while a tool holds an edit no pass has taken in (Automatic sync off): the edit is taken in first and merged as yours; a copy still settling leaves Merge undone, said so, until it lands', async () => {
  const box = await sandbox();
  try {
    const { id } = await waitingToMerge(box);
    await editIn(box, 'codex-cli', 'notes', lines('First, mine, again in Codex.'), '2026-11-05T10:00:00Z');
    assert.deepEqual(merged(await mergeIt(box, id)), [{ name: 'notes', answer: 'merge', merge: 'merged' }]);
    assert.deepEqual(await toolTexts(box), box.tools.map(() => skillMd('notes', lines('First, mine, again in Codex.', 'Last, theirs.'))));
    const told = (await readHistory(box.context)).filter(event => event.key === 'notes').slice(-2).map(event => [event.kind, event.cause ?? event.winner?.tool]);
    assert.deepEqual(told, [['edit', 'codex-cli'], ['edit', 'source-merged']], 'Codex’s edit taken in, then merged');
  } finally { await box.cleanup(); }
  const settling = await sandbox();
  try {
    const { repo, id } = await waitingToMerge(settling);
    await mergeIt(settling, id);
    await repo.commit({ 'SKILL.md': skillMd('notes', lines('First.', 'Last, theirs again.')) }, '2026-11-05T10:00:00Z');
    await check(settling, id);
    // The editor's save has moved Codex's copy away, and the settle window has not passed.
    await rm(folderOf(settling, 'codex-cli', 'notes'), { recursive: true });
    const inWindow = { ...settling, context: { ...settling.context, settleMs: 60_000 } };
    const before = { item: await itemOf(settling, 'notes'), history: (await readHistory(settling.context)).length };
    assert.deepEqual(merged(await mergeIt(inWindow, id)), [{ name: 'notes', answer: 'wait', merge: 'unsettled' }]);
    assert.deepEqual({ item: await itemOf(settling, 'notes'), history: (await readHistory(settling.context)).length }, before);
    // The save lands; the next Merge has it as yours.
    await editIn(settling, 'codex-cli', 'notes', lines('First, saved in Codex.', 'Last, theirs.'), '2026-11-06T10:00:00Z');
    assert.deepEqual(merged(await mergeIt(inWindow, id)), [{ name: 'notes', answer: 'merge', merge: 'merged' }]);
    assert.deepEqual(await toolTexts(settling), settling.tools.map(() => skillMd('notes', lines('First, saved in Codex.', 'Last, theirs again.'))));
  } finally { await settling.cleanup(); }
});

test('Git missing: Merge says it couldn’t run and changes nothing', async () => {
  const box = await sandbox(), path = process.env.PATH, nowhere = await mkdtemp(join(tmpdir(), 'ck-no-git-'));
  try {
    const { id } = await waitingToMerge(box);
    const before = { item: await itemOf(box, 'notes'), history: (await readHistory(box.context)).length, tools: await everywhere(box) };
    process.env.PATH = nowhere;
    const done = await mergeIt(box, id);
    process.env.PATH = path;
    assert.deepEqual(merged(done), [{ name: 'notes', answer: 'merge', merge: { couldNot: 'Git is not installed, so the files both sides changed can’t be merged. Install Git, then try again.' } }]);
    assert.deepEqual({ item: await itemOf(box, 'notes'), history: (await readHistory(box.context)).length, tools: await everywhere(box) }, before);
    assert.deepEqual((await readdir(join(box.home, '.central-knot'))).filter(name => name.startsWith('merging-')), []);
  } finally { process.env.PATH = path; await rm(nowhere, { recursive: true, force: true }); await box.cleanup(); }
});

// ---------- Keep mine (library.ts KEEP MINE) ----------

const keepIt = (box: Box, id: string, key = 'notes') => rowClick(box.context, box.tools, id, 'skill', key, 'keep');
/** What History is told of an item linked to a source the home records, with no tool holding a change (historyactions.ts ItemNow). */
const linkedNow = (box: Box) => ({ managed: box.tools, pending: [], linked: true as const });

test('Keep mine: yours stays current and no tool is written; the source’s version is kept as a version that was never current, no longer waits, and History says so with an Undo', async () => {
  const box = await sandbox();
  try {
    const { id, link, mine } = await waitingToMerge(box);
    const before = await toolTexts(box);
    const done = await keepIt(box, id);
    assert.deepEqual([answered(done), done.results?.filter(entry => entry.outcome === 'written' || entry.outcome === 'removed')], [[{ name: 'notes', answer: 'keep' }], []]);
    const item = (await itemOf(box, 'notes'))!, kept = item.versions.find(version => version.hash === item.seen);
    assert.deepEqual([item.hash, await toolTexts(box)], [mine, before], 'yours, in Central Knot and every tool');
    assert.deepEqual(kept?.from, { how: 'source', link, replacedBy: mine }, 'the source’s version, kept, never current');
    assert.deepEqual(await notices(box, 'notes'), ['nothing', false]);
    assert.deepEqual((await seen(box, box.context, 'notes')).fact?.fromSource, { link, nextWaits: true }, 'still changed here: the source’s next change waits');
    assert.equal((await sentences(box, 'notes')).at(-1), 'Yours stays current over github.com/team/notes’s version, which no longer waits: it is kept as a version, and the source’s next change is compared with it.');
    assert.equal(done.sourced?.[0].history, (await readHistory(box.context)).at(-1)!.id, 'the answer names its entry, whose Undo the band offers');
    assert.deepEqual(answered(await check(box, id)), [], 'the next check, with nothing new there, leaves it');
  } finally { await box.cleanup(); }
});

test('Keep mine, then the source changes again: it waits against the version kept, and Merge then merges only the new change', async () => {
  const box = await sandbox();
  try {
    // Yours changed the first line; the source changed the last. Kept: the source's last line is not taken.
    const { repo, id } = await waitingToMerge(box);
    await keepIt(box, id);
    const kept = (await readHistory(box.context)).at(-1)!;
    // The source now changes its middle as well. Against the first base its last line would come in too; against the one kept, only the middle.
    await repo.commit({ 'SKILL.md': skillMd('notes', lines('First.', 'Last, theirs.').replace('The middle.', 'The middle, theirs.')) }, '2026-11-05T10:00:00Z');
    assert.deepEqual(answered(await check(box, id)), [{ name: 'notes', answer: 'wait' }]);
    assert.deepEqual(merged(await mergeIt(box, id)), [{ name: 'notes', answer: 'merge', merge: 'merged' }]);
    assert.deepEqual(await toolTexts(box), box.tools.map(() => skillMd('notes', lines('First, mine.').replace('The middle.', 'The middle, theirs.'))));
    assert.equal(libraryAction(kept, (await itemOf(box, 'notes'))!, linkedNow(box)), undefined, 'Keep mine’s Undo is gone once another version is current');
  } finally { await box.cleanup(); }
});

test('Keep mine, its Undo, then Merge: the Undo moves only the source’s version it had taken back, writing nothing, so the update waits again and Merge takes it', async () => {
  const box = await sandbox();
  try {
    const { id, mine } = await waitingToMerge(box);
    await keepIt(box, id);
    const before = await toolTexts(box), entry = (await readHistory(box.context)).at(-1)!;
    const undo = libraryAction(entry, (await itemOf(box, 'notes'))!, linkedNow(box))!;
    assert.deepEqual([undo.label, undo.help, undo.change.version], ['Undo', 'Take back Keep mine: yours stays current, and the source’s version is no longer marked as declined', mine]);
    const undone = await restoreSkill(box.context, box.tools, entry.id);
    assert.deepEqual([undone.stopped, (await itemOf(box, 'notes'))!.hash, await toolTexts(box), await notices(box, 'notes')], [undefined, mine, before, ['wait', true]]);
    assert.equal((await sentences(box, 'notes')).at(-1), 'Undone: yours stays current; the source’s version is no longer marked as declined or taken, and the source’s row says whether an update waits.');
    assert.equal(doneWords(entry), 'Undone');
    // Neither entry offers anything now: Keep mine's Undo is used, and its own entry's way back is Keep mine on the row.
    const [kept, back] = (await readHistory(box.context)).slice(-2), item = (await itemOf(box, 'notes'))!;
    assert.deepEqual([libraryAction(kept, item, linkedNow(box)), libraryAction(back, item, linkedNow(box))], [undefined, undefined]);
    assert.deepEqual(merged(await mergeIt(box, id)), [{ name: 'notes', answer: 'merge', merge: 'merged' }]);
    assert.deepEqual(await toolTexts(box), box.tools.map(() => skillMd('notes', lines('First, mine.', 'Last, theirs.'))));
    assert.equal(libraryAction(back, (await itemOf(box, 'notes'))!, linkedNow(box)), undefined, 'the Undo’s entry offers nothing at the merged version either');
  } finally { await box.cleanup(); }
});

test('Keep mine, then its source removed: History no longer offers its Undo, on the page or in main, since no source is left to compare with', async () => {
  const box = await sandbox();
  try {
    const { id } = await waitingToMerge(box);
    await keepIt(box, id);
    const kept = (await readHistory(box.context)).at(-1)!;
    assert.deepEqual((await historyActions(box)).filter(action => action.event.id === kept.id).map(action => action.label), ['Undo']);
    await removeSource(box.context, box.tools, id);
    assert.deepEqual((await historyActions(box)).filter(action => action.event.id === kept.id), [], 'the page offers nothing');
    assert.equal((await restoreSkill(box.context, box.tools, kept.id)).stopped, 'That change has nothing left to undo: the skill is as that would leave it.', 'and main refuses it');
  } finally { await box.cleanup(); }
});

test('A conflict Merge can’t settle, fixed by hand: edited by hand, Keep mine ends the wait, and the source’s next change is compared with that version', async () => {
  const box = await sandbox();
  try {
    const { repo, id } = await waitingToMerge(box, lines('First, theirs.'));
    // Its band names SKILL.md and says Keep mine (sourcespage.ts mergeWords: scripts/e2e.mjs sourcesFlow reads it on screen).
    assert.deepEqual(merged(await mergeIt(box, id)), [{ name: 'notes', answer: 'merge', merge: { conflicts: ['SKILL.md'] } }]);
    await editHere(box, 'notes', lines('First, mine and theirs.'), '2026-11-05T10:00:00Z');
    assert.deepEqual(await notices(box, 'notes'), ['wait', true], 'an edit alone doesn’t end the wait');
    assert.deepEqual(answered(await keepIt(box, id)), [{ name: 'notes', answer: 'keep' }]);
    assert.deepEqual(await notices(box, 'notes'), ['nothing', false]);
    await repo.commit({ 'SKILL.md': skillMd('notes', lines('First, theirs.', 'Last, theirs.')) }, '2026-11-06T10:00:00Z');
    await check(box, id);
    assert.deepEqual(merged(await mergeIt(box, id)), [{ name: 'notes', answer: 'merge', merge: 'merged' }], 'only the last line is new against the version kept');
    assert.deepEqual(await toolTexts(box), box.tools.map(() => skillMd('notes', lines('First, mine and theirs.', 'Last, theirs.'))));
  } finally { await box.cleanup(); }
});

test('Keep mine while a tool holds an edit no pass has taken in (Automatic sync off): it writes nothing, so it doesn’t wait on that copy; the edit is then taken in and stays current', async () => {
  const box = await sandbox();
  try {
    const { id } = await waitingToMerge(box);
    await editIn(box, 'codex-cli', 'notes', lines('First, mine in Codex.'), '2026-11-05T10:00:00Z');
    assert.deepEqual(answered(await keepIt(box, id)), [{ name: 'notes', answer: 'keep' }]);
    assert.deepEqual(await toolTexts(box), box.tools.map(() => skillMd('notes', lines('First, mine in Codex.'))));
    assert.deepEqual(await notices(box, 'notes'), ['nothing', false]);
  } finally { await box.cleanup(); }
});

test('Make current, as the item’s page offers: an older version made current waits on the source’s next change; its Undo makes the item follow again', async () => {
  const box = await sandbox();
  try {
    const { repo, id } = await oneSkill(box, 'notes', { on: true });
    await repo.commit({ 'SKILL.md': skillMd('notes', 'Second.') }, '2026-11-02T10:00:00Z');
    await check(box, id);
    const first = (await itemOf(box, 'notes'))!.versions.find(version => version.at.startsWith('2026-11-01'))!.hash;
    await applySkills(box.context, box.tools, [{ key: 'notes', on: true, except: [], version: first }]);
    await repo.commit({ 'SKILL.md': skillMd('notes', 'Third.') }, '2026-11-03T10:00:00Z');
    assert.deepEqual(answered(await check(box, id)), [{ name: 'notes', answer: 'wait' }]);
    assert.equal(await bodyOf(box, 'notes'), 'First.');
    await restoreSkill(box.context, box.tools, (await readHistory(box.context)).filter(event => event.key === 'notes' && event.kind === 'current').at(-1)!.id);
    assert.equal(await bodyOf(box, 'notes'), 'Second.', 'back at the version it last took from the source');
    assert.deepEqual(answered(await check(box, id)), [{ name: 'notes', answer: 'update' }]);
    assert.equal(await bodyOf(box, 'notes'), 'Third.');
  } finally { await box.cleanup(); }
});

test('Edited back by hand to exactly what it took from the source: it follows the next change without a click; edited to exactly the source’s new text, Check now only notes it, and says nothing was updated', async () => {
  const box = await sandbox();
  try {
    const { repo, id } = await oneSkill(box, 'notes', { on: true });
    await editHere(box, 'notes', 'Mine.');
    await repo.commit({ 'SKILL.md': skillMd('notes', 'Second.') }, '2026-11-04T10:00:00Z');
    assert.deepEqual(answered(await check(box, id)), [{ name: 'notes', answer: 'wait' }]);
    await editHere(box, 'notes', 'First.', '2026-11-05T10:00:00Z');
    assert.deepEqual(answered(await check(box, id)), [{ name: 'notes', answer: 'update' }]);
    assert.equal(await bodyOf(box, 'notes'), 'Second.');

    await repo.commit({ 'SKILL.md': skillMd('notes', 'Third.') }, '2026-11-06T10:00:00Z');
    await editHere(box, 'notes', 'Third.', '2026-11-07T10:00:00Z');
    const entries = (await readHistory(box.context)).length, done = await check(box, id);
    // Nothing a person sees changed: no answer to word (the page's band then says there was nothing to bring in), no entry.
    assert.deepEqual([answered(done), (await readHistory(box.context)).length], [[], entries]);
    await repo.commit({ 'SKILL.md': skillMd('notes', 'Fourth.') }, '2026-11-08T10:00:00Z');
    assert.deepEqual(answered(await check(box, id)), [{ name: 'notes', answer: 'update' }], 'it took the source’s text by hand, so it follows');
  } finally { await box.cleanup(); }
});

test('Turned Off and On, and written to a tool managed for the first time: neither is a change made here, so the item follows the source’s next change', async () => {
  const box = await sandbox();
  try {
    const { repo, id } = await oneSkill(box, 'notes', { on: true });
    await applySkills(box.context, box.tools, [{ key: 'notes', on: false, except: [], seenOn: true }]);
    await applySkills(box.context, box.tools, [{ key: 'notes', on: true, except: [], seenOn: false }]);
    await repo.commit({ 'SKILL.md': skillMd('notes', 'Second.') }, '2026-11-02T10:00:00Z');
    assert.deepEqual(answered(await check(box, id)), [{ name: 'notes', answer: 'update' }]);
    // Codex left out, then managed again: the pass writes the current version there.
    await chooseTools(box.context, 'codex-cli', false);
    await applySkills(box.context, ['claude-cli', 'copilot-cli'], []);
    await rm(folderOf(box, 'codex-cli', 'notes'), { recursive: true });
    await chooseTools(box.context, 'codex-cli', true);
    await applySkills(box.context, box.tools, []);
    assert.equal(await toolBody(box, 'codex-cli', 'notes'), 'Second.');
    await repo.commit({ 'SKILL.md': skillMd('notes', 'Third.') }, '2026-11-03T10:00:00Z');
    assert.deepEqual(answered(await check(box, id)), [{ name: 'notes', answer: 'update' }]);
  } finally { await box.cleanup(); }
});

test('While its version waits, the source drops the skill: it turns Off, and its row says the source removed it instead of that a version waits; its SKILL.md unparseable there instead: nothing turns Off, no notice while there is nothing to take, and it is back once it can be read', async () => {
  const box = await sandbox();
  try {
    const { repo, id, link } = await oneSkill(box, 'notes', { on: true });
    await editHere(box, 'notes', 'Mine.');
    await repo.commit({ 'SKILL.md': skillMd('notes', 'Theirs.') }, '2026-11-04T10:00:00Z');
    await check(box, id);
    await repo.commit({ 'SKILL.md': '---\nname: [notes\n---\nBroken.\n' }, '2026-11-05T10:00:00Z');
    const unread = await check(box, id);
    assert.deepEqual([answered(unread), unread.notWhole, (await itemOf(box, 'notes'))!.on, await bodyOf(box, 'notes')], [[], true, true, 'Mine.']);
    assert.deepEqual(await notices(box, 'notes'), ['unreadable', false]);
    await repo.commit({ 'SKILL.md': skillMd('notes', 'Theirs.') }, '2026-11-06T10:00:00Z');
    await check(box, id);
    assert.deepEqual(await notices(box, 'notes'), ['wait', true]);

    await repo.commit({ 'SKILL.md': skillMd('jottings', 'Renamed.') }, '2026-11-07T10:00:00Z');
    assert.deepEqual(answered(await check(box, id)), [{ name: 'jottings', answer: 'make' }, { name: 'notes', answer: 'drop' }]);
    assert.deepEqual([(await itemOf(box, 'notes'))!.on, await bodyOf(box, 'notes'), (await seen(box, box.context, 'notes')).fact?.fromSource], [false, 'Mine.', { link, removed: true }]);
  } finally { await box.cleanup(); }
});

test('Once a day: a source whose last read is a day old is checked by itself, as Check now checks it, never with Automatic sync off; one read within the day is not; a failed fetch is tried again an hour later, not at every turn', async () => {
  const box = await sandbox();
  try {
    const { repo, id } = await oneSkill(box, 'notes', { on: true });
    const readAt = async () => Date.parse((await sourcesView(box.context, box.tools)).sources.find(source => source.id === id)!.readAt!);
    const due = (at: number, syncOn = true) => checkDue(box.context, now(box), inTurn, { syncOn, now: at });
    const first = await readAt();
    await repo.commit({ 'SKILL.md': skillMd('notes', 'Second.') }, '2026-11-02T10:00:00Z');
    assert.deepEqual(await due(first + SOURCE_CHECK_EVERY_MS - 1), [], 'read within the day');
    assert.deepEqual(await due(first + SOURCE_CHECK_EVERY_MS, false), [], 'Automatic sync off');
    const [checked, ...more] = await due(first + SOURCE_CHECK_EVERY_MS);
    assert.deepEqual([answered(checked.done), more], [[{ name: 'notes', answer: 'update' }], []]);
    for (const tool of box.tools) assert.equal(await toolBody(box, tool, 'notes'), 'Second.');
    const second = await readAt();
    assert.deepEqual(await due(second + SOURCE_CHECK_EVERY_MS - 1), [], 'a day from the read it just made');
    // A day later the repository is gone: the fetch fails, the last read and its time stay, and the turns within the hour fetch nothing.
    await rm(repo.dir, { recursive: true });
    const dayLater = second + 2 * SOURCE_CHECK_EVERY_MS, [failed] = await due(dayLater);
    assert.match(failed.done.stopped ?? '', /^Couldn’t read github\.com\/team\/notes\./);
    assert.equal(await readAt(), second);
    assert.deepEqual(await due(dayLater + 59 * 60_000), []);
    assert.equal((await due(dayLater + 60 * 60_000)).length, 1);
  } finally { await box.cleanup(); }
});

test('Gone, read whole: a skill renamed at the source turns Off once, said in History, and is no longer linked; turned back On, the next check leaves it On, and the new name comes in Off', async () => {
  const box = await sandbox();
  try {
    const { repo, id } = await oneSkill(box, 'notes', { on: true });
    await repo.commit({ 'SKILL.md': skillMd('jottings', 'First.') }, '2026-11-02T10:00:00Z');
    const done = await check(box, id);
    assert.deepEqual(answered(done), [{ name: 'jottings', answer: 'make' }, { name: 'notes', answer: 'drop' }]);
    const item = (await itemOf(box, 'notes'))!;
    assert.deepEqual([item.on, item.source, item.seen], [false, undefined, undefined]);
    assert.deepEqual(Object.values(await everywhere(box)).filter(Boolean), [], 'removed from every tool, kept in Central Knot');
    assert.equal((await sentences(box, 'notes')).at(-1), 'github.com/team/notes no longer has it, so it is off and removed from all 3 tools, and no longer from that source. Central Knot keeps it.');
    const turnOn = libraryAction((await readHistory(box.context)).filter(event => event.key === 'notes').at(-1)!, item, { managed: box.tools, pending: [] })!;
    assert.equal(turnOn.label, 'Turn on');
    await applySkills(box.context, box.tools, [turnOn.change]);
    assert.deepEqual(answered(await check(box, id)), [], 'the next check leaves it');
    assert.equal((await itemOf(box, 'notes'))!.on, true);
    assert.deepEqual([(await itemOf(box, 'jottings'))!.on, (await itemOf(box, 'jottings'))!.source], [false, id]);
  } finally { await box.cleanup(); }
});

// ---------- A click on a name's line, as main.ts passes it on ----------

test('A click on a source’s line in a kind no source brings, or a click no line has, is refused in plain words and changes nothing; the same line in its own kind and click does its work', async () => {
  const box = await sandbox();
  try {
    const { id } = await waitingToMerge(box);
    // main.ts passes on whatever the page sent, as text: here a kind and a click this version has no line for.
    const before = [await bytes(box.home), (await readHistory(box.context)).length];
    const wrongKind = await rowClick(box.context, box.tools, id, 'plugin', 'notes', 'replace');
    const wrongClick = await rowClick(box.context, box.tools, id, 'skill', 'notes', 'replaceAll');
    assert.deepEqual([wrongKind.stopped, wrongKind.sourced], ['A source’s line has no click “replace” for a “plugin”, so nothing was changed.', undefined]);
    assert.deepEqual([wrongClick.stopped, wrongClick.sourced], ['A source’s line has no click “replaceAll” for a “skill”, so nothing was changed.', undefined]);
    assert.deepEqual([await bytes(box.home), (await readHistory(box.context)).length], before, 'every file in the home, and History, as they were');
    assert.equal(wrongKind.view?.sources[0].names.find(name => name.key === 'notes')?.state, 'wait', 'the source’s version still waits');
    assert.deepEqual(answered(await rowClick(box.context, box.tools, id, 'skill', 'notes', 'replace')), [{ name: 'notes', answer: 'update' }], 'its own kind and click: Replace');
  } finally { await box.cleanup(); }
});

// ---------- A skill its source removed (library.ts REMOVED AT ITS SOURCE) ----------

/** What a skill's row on Skills says of its source (types.ts LibraryFacts fromSource), which the Sources page reads too. */
const fromSourceOf = async (box: Box, key = 'notes') => (await seen(box, box.context, key)).fact?.fromSource;
/** Turn on, on a removed skill's line on Sources: its switch on Skills, On (sourcespage.ts turnOn). */
const turnOnAgain = async (box: Box, tools = box.tools, key = 'notes') => applySkills(box.context, tools, [{ ...asItIs(key, await itemOf(box, key)), on: true, seenOn: false }]);
/** The source renames notes jottings, then is read: notes is gone there, read whole. */
const dropNotes = async (box: Box, repo: { commit: (files: Record<string, string | null>, when?: string) => Promise<string> }, id: string) => {
  await repo.commit({ 'SKILL.md': skillMd('jottings', 'First.') }, '2026-11-02T10:00:00Z');
  return check(box, id);
};

test('The check once a day drops a skill with the window closed: its row says the source removed it, worked out from the record and the source’s last read alone, so it still does once History has let go of the drop', async () => {
  const box = await sandbox();
  try {
    const { repo, id, link } = await oneSkill(box, 'notes', { on: true });
    await repo.commit({ 'SKILL.md': skillMd('jottings', 'First.') }, '2026-11-02T10:00:00Z');
    const readAt = Date.parse((await sourcesView(box.context, box.tools)).sources[0].readAt!);
    const [checked] = await checkDue(box.context, now(box), inTurn, { syncOn: true, now: readAt + SOURCE_CHECK_EVERY_MS });
    assert.deepEqual(answered(checked.done), [{ name: 'jottings', answer: 'make' }, { name: 'notes', answer: 'drop' }]);
    assert.deepEqual(await fromSourceOf(box), { link, removed: true });
    assert.deepEqual(fromSourceWords({ link, removed: true }), {
      tag: { text: 'removed at its source', title: 'github.com/team/notes no longer has it: it is Off, and no longer from that source. Turn it on to use it again.' },
      before: 'github.com/team/notes no longer has it: it is Off, and no longer from that source. Turn it on to use it again. Should github.com/team/notes have it again, it follows the source if unchanged here, and stays as you have it if you changed it. See ',
      after: '.' });
    // A hundred days on, History holds nothing of it; nothing else was kept about it, and a fresh look says the same.
    await pruneHistory({ ...box.context, now: () => Date.now() + 100 * DAY_MS });
    assert.deepEqual((await readHistory(box.context)).filter(event => event.cause === 'source-dropped'), []);
    assert.deepEqual([await fromSourceOf(box), (await itemOf(box, 'notes'))!.on], [{ link, removed: true }, false]);
    assert.deepEqual(answered(await check(box, id)), [], 'a quiet read changes nothing');
    assert.deepEqual(await fromSourceOf(box), { link, removed: true });
  } finally { await box.cleanup(); }
});

test('Turned On again, the revert: the notice goes, the next read changes nothing, and it is in the tools the rules allow now: not one left out meanwhile, and a copy made by hand meanwhile is kept as a version; Off again, the notice is back', async () => {
  const box = await sandbox();
  try {
    const { repo, id, link } = await oneSkill(box, 'notes', { on: true });
    await dropNotes(box, repo, id);
    await chooseTools(box.context, 'codex-cli', false);
    await put(box, 'copilot-cli', { 'SKILL.md': skillMd('notes', 'By hand.') });
    const managed = box.tools.filter(tool => tool !== 'codex-cli');
    const done = await turnOnAgain(box, managed);
    assert.deepEqual(done.results.filter(entry => entry.outcome === 'written').map(entry => entry.harness), managed);
    assert.deepEqual([await toolBody(box, 'claude-cli', 'notes'), await toolBody(box, 'copilot-cli', 'notes'), (await everywhere(box))['codex-cli']], ['First.', 'First.', undefined]);
    assert.ok((await itemOf(box, 'notes'))!.versions.some(version => version.from.how === 'was-in' && version.from.harness === 'copilot-cli'), 'the copy made by hand is a version');
    assert.equal((await sentences(box, 'notes')).at(-1), 'Turned on: put in Claude Code and Copilot CLI. Copilot CLI’s own folder was written over and kept as a version.');
    assert.equal(await fromSourceOf(box), undefined);
    assert.deepEqual(answered(await checkSource(box.context, async () => managed, id, inTurn)), [], 'the read leaves it: it is no longer from the source');
    assert.deepEqual([(await itemOf(box, 'notes'))!.on, await fromSourceOf(box)], [true, undefined]);
    await applySkills(box.context, managed, [{ ...asItIs('notes', await itemOf(box, 'notes')), on: false, seenOn: true }]);
    assert.deepEqual(await fromSourceOf(box), { link, removed: true });
  } finally { await box.cleanup(); }
});

test('History’s Turn on and a profile that includes it are reverts too: each turns it On, and the notice goes', async () => {
  const { saveProfile, switchProfile } = await import('../src/profiles.ts');
  const box = await sandbox();
  try {
    const { repo, id } = await oneSkill(box, 'notes', { on: true });
    const profile = (await saveProfile(box.context, { name: 'Writing', items: ['skill:notes'] })).id!;
    await dropNotes(box, repo, id);
    const dropped = (await readHistory(box.context)).filter(event => event.key === 'notes').at(-1)!;
    await restoreSkill(box.context, box.tools, dropped.id);
    assert.deepEqual([(await itemOf(box, 'notes'))!.on, await fromSourceOf(box)], [true, undefined]);
    await applySkills(box.context, box.tools, [{ ...asItIs('notes', await itemOf(box, 'notes')), on: false, seenOn: true }]);
    assert.equal((await fromSourceOf(box))?.removed, true);
    await switchProfile(box.context, box.tools, profile);
    assert.deepEqual([(await itemOf(box, 'notes'))!.on, await fromSourceOf(box)], [true, undefined]);
  } finally { await box.cleanup(); }
});

test('Removed, then back before anything was done: unchanged here, it is linked again, takes the source’s version and stays Off; changed here, it is not brought in and keeps your version; either way the notice goes', async () => {
  const box = await sandbox();
  try {
    const { repo, id, link } = await oneSkill(box, 'notes', { on: true });
    await dropNotes(box, repo, id);
    await repo.commit({ 'SKILL.md': skillMd('notes', 'Back.') }, '2026-11-03T10:00:00Z');
    assert.deepEqual(answered(await check(box, id)), [{ name: 'notes', answer: 'update' }, { name: 'jottings', answer: 'drop' }]);
    const item = (await itemOf(box, 'notes'))!;
    assert.deepEqual([item.on, item.source, await bodyOf(box, 'notes'), await fromSourceOf(box)], [false, id, 'Back.', { link }]);

    // Changed here this time: Made current at an older version while it was removed, then the name comes back.
    await dropNotes(box, repo, id);
    const was = (await itemOf(box, 'notes'))!, older = was.versions.find(version => version.hash !== was.hash)!.hash;
    await applySkills(box.context, box.tools, [{ ...asItIs('notes', await itemOf(box, 'notes')), version: older }]);
    await repo.commit({ 'SKILL.md': skillMd('notes', 'Back again.') }, '2026-11-04T10:00:00Z');
    assert.deepEqual((await check(box, id)).sourced?.find(entry => entry.name === 'notes')?.answer, 'differs');
    assert.deepEqual([(await itemOf(box, 'notes'))!.hash, (await itemOf(box, 'notes'))!.source, await fromSourceOf(box)], [older, undefined, undefined]);
  } finally { await box.cleanup(); }
});

test('A source that can’t be read whole after the drop is no reason to think the skill is back: the notice stays; a read that holds its name again, even one that can’t be read, ends it, and that line says why', async () => {
  const box = await sandbox();
  try {
    const { repo, id, link } = await oneSkill(box, 'notes', { on: true });
    await dropNotes(box, repo, id);
    await repo.commit({ 'SKILL.md': null, 'jottings/SKILL.md': skillMd('jottings', 'First.'), 'broken/SKILL.md': '---\nname: [broken\n---\nBroken.\n' }, '2026-11-03T10:00:00Z');
    assert.equal((await check(box, id)).notWhole, true);
    assert.deepEqual(await fromSourceOf(box), { link, removed: true }, 'a skill there unreadable: not read whole');
    await repo.commit({ 'jottings': null, 'broken': null, 'README.md': '# Nothing here now\n' }, '2026-11-03T11:00:00Z');
    assert.equal((await check(box, id)).notWhole, true);
    assert.deepEqual(await fromSourceOf(box), { link, removed: true }, 'no skill there at all: not read whole');
    await rm(repo.dir, { recursive: true });
    assert.match((await check(box, id)).stopped ?? '', /^Couldn’t read/);
    assert.deepEqual(await fromSourceOf(box), { link, removed: true }, 'the repository gone: its last read stays');
    const back = await repository(hosts, link);
    await back.commit({ 'notes/SKILL.md': '---\nname: [notes\n---\nBroken.\n', 'jottings/SKILL.md': skillMd('jottings', 'First.') }, '2026-11-05T10:00:00Z');
    await check(box, id);
    assert.equal(await fromSourceOf(box), undefined);
    assert.deepEqual((await sourcesView(box.context, box.tools)).sources[0].names.find(name => name.key === 'notes')?.state, 'unreadable');
  } finally { await box.cleanup(); }
});

test('A skill that was here already, the same, when the source was added: linked, its content recorded as a version from the source too; removed there, it turns Off and both pages say so', async () => {
  const box = await sandbox();
  try {
    await put(box, 'claude-cli', { 'SKILL.md': skillMd('notes', 'Mine and theirs.') });
    await applySkills(box.context, box.tools, [{ key: 'notes', on: true, except: [], seenOn: false }]);
    const repo = await repository(hosts, 'https://github.com/team/notes'), link = 'https://github.com/team/notes';
    await repo.commit({ 'SKILL.md': skillMd('notes', 'Mine and theirs.') }, '2026-11-01T10:00:00Z');
    assert.deepEqual(answered((await add(box, link)).added), [{ name: 'notes', answer: 'link' }]);
    const item = (await itemOf(box, 'notes'))!;
    assert.deepEqual([item.versions[0].hash, item.versions[0].from], [item.hash, { how: 'source', link }], 'the same content, as the source has it');
    await dropNotes(box, repo, await sourceId(box));
    assert.deepEqual([(await itemOf(box, 'notes'))!.on, await fromSourceOf(box)], [false, { link, removed: true }]);
  } finally { await box.cleanup(); }
});

test('Deleted after its source removed it, then written by hand and taken in again: his own skill, so turned Off nothing calls it removed at its source', async () => {
  const box = await sandbox();
  try {
    const { repo, id } = await oneSkill(box, 'notes', { on: true });
    await dropNotes(box, repo, id);
    await applySkills(box.context, box.tools, [{ ...asItIs('notes', await itemOf(box, 'notes')), deleted: true }]);
    await put(box, 'claude-cli', { 'SKILL.md': skillMd('notes', 'My very own notes.') });
    await applySkills(box.context, box.tools, [{ key: 'notes', on: true, except: [], seenOn: false }]);
    await applySkills(box.context, box.tools, [{ ...asItIs('notes', await itemOf(box, 'notes')), on: false, seenOn: true }]);
    assert.deepEqual([(await itemOf(box, 'notes'))!.on, (await itemOf(box, 'notes'))!.versions.some(version => version.from.link), await fromSourceOf(box)], [false, true, undefined],
      'its versions from before the Delete are kept, and say nothing about the skill taken in since');
  } finally { await box.cleanup(); }
});

test('Removed, deleted, written again by hand the same and added, then back at the source the same: linked again with a version from the source since that take-in, so a second removal shows the notice', async () => {
  const box = await sandbox();
  try {
    const { repo, id, link } = await oneSkill(box, 'notes', { on: true });
    await dropNotes(box, repo, id);
    await applySkills(box.context, box.tools, [{ ...asItIs('notes', await itemOf(box, 'notes')), deleted: true }]);
    await put(box, 'claude-cli', { 'SKILL.md': skillMd('notes', 'First.') });
    await applySkills(box.context, box.tools, [{ key: 'notes', on: true, except: [], seenOn: false }]);
    await repo.commit({ 'SKILL.md': skillMd('notes', 'First.') }, '2026-11-03T10:00:00Z');
    assert.deepEqual((await check(box, id)).sourced?.find(entry => entry.name === 'notes')?.answer, 'link');
    await applySkills(box.context, box.tools, [{ ...asItIs('notes', await itemOf(box, 'notes')), on: false, seenOn: true }]);
    await repo.commit({ 'SKILL.md': skillMd('jottings', 'First.') }, '2026-11-04T10:00:00Z');
    await check(box, id);
    assert.deepEqual(await fromSourceOf(box), { link, removed: true });
  } finally { await box.cleanup(); }
});

test('Deleted while still at its source, then written again by hand and added: no longer linked; differing, the next read doesn’t bring it in; the same, the next read links it again, and a removal then shows the notice', async () => {
  const box = await sandbox();
  try {
    const { repo, id, link } = await oneSkill(box, 'notes', { on: true });
    const writtenAgain = async (body: string) => {
      await applySkills(box.context, box.tools, [{ ...asItIs('notes', await itemOf(box, 'notes')), deleted: true }]);
      await put(box, 'claude-cli', { 'SKILL.md': skillMd('notes', body) });
      await applySkills(box.context, box.tools, [{ key: 'notes', on: true, except: [], seenOn: false }]);
    };
    await writtenAgain('Mine.');
    assert.deepEqual([(await itemOf(box, 'notes'))!.source, await fromSourceOf(box)], [undefined, undefined], 'taken in again, it is his: no longer linked');
    assert.deepEqual((await check(box, id)).sourced?.find(entry => entry.name === 'notes')?.answer, 'differs');
    await writtenAgain('First.');
    assert.deepEqual((await check(box, id)).sourced?.find(entry => entry.name === 'notes')?.answer, 'link');
    await applySkills(box.context, box.tools, [{ ...asItIs('notes', await itemOf(box, 'notes')), on: false, seenOn: true }]);
    await dropNotes(box, repo, id);
    assert.deepEqual(await fromSourceOf(box), { link, removed: true });
  } finally { await box.cleanup(); }
});

test('Deleted, or its source removed, while the notice shows: it goes, since nothing it would say is so any more; Restore brings it back', async () => {
  const box = await sandbox();
  try {
    const { repo, id, link } = await oneSkill(box, 'notes', { on: true });
    await dropNotes(box, repo, id);
    await applySkills(box.context, box.tools, [{ ...asItIs('notes', await itemOf(box, 'notes')), deleted: true }]);
    assert.equal(await fromSourceOf(box), undefined);
    await applySkills(box.context, box.tools, [{ ...asItIs('notes', await itemOf(box, 'notes')), deleted: false }]);
    assert.deepEqual(await fromSourceOf(box), { link, removed: true });
    await removeSource(box.context, box.tools, id);
    assert.deepEqual([await fromSourceOf(box), (await itemOf(box, 'notes'))!.on], [undefined, false]);
  } finally { await box.cleanup(); }
});

test('Turned Off, then the source updates it: it stays Off and the new content is current', async () => {
  const box = await sandbox();
  try {
    const { repo, id } = await oneSkill(box, 'notes', { on: true });
    await applySkills(box.context, box.tools, [{ key: 'notes', on: false, except: [], seenOn: true }]);
    await repo.commit({ 'SKILL.md': skillMd('notes', 'Second.') }, '2026-11-02T10:00:00Z');
    await check(box, id);
    assert.deepEqual([(await itemOf(box, 'notes'))!.on, await bodyOf(box, 'notes')], [false, 'Second.']);
    assert.deepEqual(Object.values(await everywhere(box)).filter(Boolean), []);
  } finally { await box.cleanup(); }
});

// ---------- A name the library has ----------

test('A name the library already has: the same content is linked and nothing else changes; a different one is not brought in, and the rest is', async () => {
  const box = await sandbox();
  try {
    await put(box, 'claude-cli', { 'SKILL.md': skillMd('same', 'Same.') }, [], 'same');
    await put(box, 'claude-cli', { 'SKILL.md': skillMd('review', 'My own review.') }, [], 'review');
    await applySkills(box.context, box.tools, ['same', 'review'].map(key => ({ key, on: true, except: [], seenOn: false })));
    const before = await everywhere(box, 'review');
    const repo = await repository(hosts, 'https://github.com/team/kit');
    await repo.commit({ 'same/SKILL.md': skillMd('same', 'Same.'), 'review/SKILL.md': skillMd('review', 'Their review.'), 'fresh/SKILL.md': skillMd('fresh') });
    const look = await previewSource(box.context, box.tools, 'https://github.com/team/kit') as Extract<SourcePreview, { token: string }>;
    assert.deepEqual(look.names.map(name => [name.name, name.state]), [['fresh', 'make'], ['review', 'differs'], ['same', 'link']]);
    const { added } = { added: await addSource(box.context, box.tools, look.token) };
    assert.deepEqual(answered(added), [{ name: 'fresh', answer: 'make' }, { name: 'review', answer: 'differs' }, { name: 'same', answer: 'link' }]);
    const id = await sourceId(box);
    assert.deepEqual([(await itemOf(box, 'same'))!.source, (await itemOf(box, 'same'))!.on, (await itemOf(box, 'review'))!.source], [id, true, undefined]);
    assert.deepEqual(await everywhere(box, 'review'), before, 'the person’s own review is as it was in every tool');
    assert.deepEqual((await sourcesView(box.context, box.tools)).sources[0].names.map(name => [name.name, name.state]), [['fresh', 'nothing'], ['review', 'differs'], ['same', 'nothing']]);
    // Its source changing it later never reaches the person's own review.
    await repo.commit({ 'review/SKILL.md': skillMd('review', 'Their newer review.') });
    await check(box, id);
    assert.deepEqual(await everywhere(box, 'review'), before);
  } finally { await box.cleanup(); }
});

test('A second source with a name the first brought: not brought in, said with the first one’s link', async () => {
  const box = await sandbox();
  try {
    const { link } = await oneSkill(box, 'notes');
    const other = await repository(hosts, 'https://github.com/other/notes');
    await other.commit({ 'SKILL.md': skillMd('notes', 'First.') });
    const look = await previewSource(box.context, box.tools, 'https://github.com/other/notes') as Extract<SourcePreview, { token: string }>;
    assert.deepEqual(look.names.map(name => [name.state, name.why]), [['another', link]]);
  } finally { await box.cleanup(); }
});

test('A skill deleted from Central Knot: the tombstone holds at Check now and at Add; Add on its row brings it back, Off, at the source’s version', async () => {
  const box = await sandbox();
  try {
    const { repo, id } = await oneSkill(box, 'notes', { on: true });
    await applySkills(box.context, box.tools, [{ key: 'notes', on: true, except: [], seenOn: true, deleted: true }]);
    await repo.commit({ 'SKILL.md': skillMd('notes', 'Second.') });
    assert.deepEqual(answered(await check(box, id)), [{ name: 'notes', answer: 'deleted' }]);
    assert.ok((await itemOf(box, 'notes'))!.deleted, 'still deleted');
    assert.deepEqual((await sourcesView(box.context, box.tools)).sources[0].names.map(name => name.state), ['deleted']);
    const back = await rowClick(box.context, box.tools, id, 'skill', 'notes', 'bringBack');
    assert.deepEqual(answered(back), [{ name: 'notes', answer: 'make' }]);
    const item = (await itemOf(box, 'notes'))!;
    assert.deepEqual([item.deleted, item.on, item.source, await bodyOf(box, 'notes')], [undefined, false, id, 'Second.']);
    assert.ok(item.versions.length >= 2, 'its earlier versions come back with it');
  } finally { await box.cleanup(); }
});

// ---------- What is at a link ----------

test('A link to a plugin, or a marketplace, is named as that and nothing there is read; a folder of loose skills beside an agents folder and a commands folder brings the skills and the agent, never a command', async () => {
  const box = await sandbox();
  try {
    const plugin = await repository(hosts, 'https://github.com/team/plugin');
    await plugin.commit({ '.claude-plugin/plugin.json': '{"name":"plugin"}', 'skills/pdf/SKILL.md': skillMd('pdf') });
    const said = await previewSource(box.context, box.tools, 'https://github.com/team/plugin');
    assert.deepEqual(['holds' in said && said.holds, said.refused], ['plugin', 'The link holds a plugin (a .claude-plugin or .codex-plugin folder). Plugins from a link come in a later version; nothing here is read.']);
    const market = await repository(hosts, 'https://github.com/team/market');
    await market.commit({ '.agents/plugins/marketplace.json': '{}' });
    assert.match((await previewSource(box.context, box.tools, 'https://github.com/team/market')).refused ?? '', /holds a marketplace/);

    const loose = await repository(hosts, 'https://github.com/team/loose');
    await loose.commit({ 'pdf/SKILL.md': skillMd('pdf'), 'docx/SKILL.md': skillMd('docx'), 'agents/writer.md': '---\nname: writer\n---\nWrite.\n', 'commands/go.md': 'Go.\n' });
    const look = await previewSource(box.context, box.tools, 'https://github.com/team/loose') as Extract<SourcePreview, { token: string }>;
    assert.deepEqual([look.refused, look.names.map(name => `${name.kind} ${name.name}`)], [undefined, ['skill docx', 'skill pdf', 'agent writer']]);
  } finally { await box.cleanup(); }
});

test('Central Knot’s own layout given as a link: its skills and agents come in, Off; its MCP servers and base instructions are not read', async () => {
  const box = await sandbox();
  try {
    const repo = await repository(hosts, 'https://github.com/me/agent-config');
    await repo.commit({ 'skills/notes/SKILL.md': skillMd('notes'), 'mcp/github.json': '{"command":"gh"}', 'agents/writer.md': '---\nname: writer\n---\nWrite.\n', 'instructions/base.md': 'Be brief.\n' });
    const look = await previewSource(box.context, box.tools, 'me/agent-config') as Extract<SourcePreview, { token: string }>;
    assert.deepEqual(look.names.map(name => [name.kind, name.name, name.there?.folder]), [['skill', 'notes', 'skills/notes'], ['agent', 'writer', 'agents']]);
  } finally { await box.cleanup(); }
});

test('A branch whose name holds a slash, and a GitLab folder link in a group of groups: each is split by the branches the repository has', async () => {
  const box = await sandbox();
  try {
    const repo = await repository(hosts, 'https://github.com/team/kit');
    await repo.commit({ 'README.md': 'Kit.\n' });
    repo.branch('feature/x');
    await repo.commit({ 'skills/notes/SKILL.md': skillMd('notes', 'On the feature branch.') });
    // A tag named `feature` too: the link's branch is the longest name the repository has that the link starts with.
    repo.git('tag', 'feature');
    const look = await previewSource(box.context, box.tools, 'https://github.com/team/kit/tree/feature/x/skills/notes') as Extract<SourcePreview, { token: string }>;
    assert.deepEqual([look.ref, look.folder, look.names.map(name => name.name)], ['feature/x', 'skills/notes', ['notes']]);

    const lab = await repository(hosts, 'https://gitlab.example.com/team/tools/skills');
    await lab.commit({ 'review/SKILL.md': skillMd('review') });
    const there = await previewSource(box.context, box.tools, 'https://gitlab.example.com/team/tools/skills/-/tree/main/review') as Extract<SourcePreview, { token: string }>;
    assert.deepEqual([there.repository, there.ref, there.folder, there.names.map(name => name.name)], ['https://gitlab.example.com/team/tools/skills.git', 'main', 'review', ['review']]);
    assert.equal((await previewSource(box.context, box.tools, 'https://github.com/team/kit/tree/nope/skills')).refused, 'The repository has no branch or tag named nope, or by any longer name this link starts with.');
  } finally { await box.cleanup(); }
});

test('A SKILL.md that stops parsing at a later check can’t be read, and is not gone: nothing turns Off, and its row says why', async () => {
  const box = await sandbox();
  try {
    const repo = await repository(hosts, 'https://github.com/team/kit');
    await repo.commit({ 'notes/SKILL.md': skillMd('notes'), 'other/SKILL.md': skillMd('other'), 'third/SKILL.md': skillMd('third') });
    await add(box, 'https://github.com/team/kit');
    const id = await sourceId(box);
    await applySkills(box.context, box.tools, [{ key: 'notes', on: true, except: [], seenOn: false }]);
    await repo.commit({ 'notes/SKILL.md': '---\nname: [notes\n---\nBroken.\n', 'other/SKILL.md': null });
    assert.deepEqual(answered(await check(box, id)), []);
    assert.deepEqual([(await itemOf(box, 'notes'))!.on, (await itemOf(box, 'other'))!.source], [true, id], 'not read whole: nothing is gone this time');
    const row = (await sourcesView(box.context, box.tools)).sources[0];
    assert.deepEqual([row.unread, row.names.map(name => [name.key, name.state, name.why])], [undefined,
      [['notes', 'unreadable', 'its SKILL.md can’t be read as a skill (Malformed YAML frontmatter)'], ['third', 'nothing', undefined], ['other', 'nothing', undefined]]], 'the skill’s own line says why, once');
    // No skill there that can be read: still a read, not whole; nothing turns Off, and each reason is said.
    await repo.commit({ 'third/SKILL.md': null });
    const done = await check(box, id);
    assert.deepEqual([done.stopped, done.notWhole], [undefined, true]);
    assert.deepEqual([(await itemOf(box, 'notes'))!.on, (await itemOf(box, 'third'))!.source], [true, id]);
  } finally { await box.cleanup(); }
});

test('The link’s folder deleted or moved at the source: the whole source can’t be read, nothing turns Off, and its row says why', async () => {
  const box = await sandbox();
  try {
    const repo = await repository(hosts, 'https://github.com/team/kit');
    await repo.commit({ 'skills/notes/SKILL.md': skillMd('notes') });
    await add(box, 'https://github.com/team/kit/tree/main/skills/notes');
    const id = await sourceId(box);
    await applySkills(box.context, box.tools, [{ key: 'notes', on: true, except: [], seenOn: false }]);
    await repo.commit({ 'skills/notes': null, 'moved/notes/SKILL.md': skillMd('notes') });
    const done = await check(box, id), why = 'Nothing at the folder skills/notes on main to read: moved or deleted there, or not read here yet.';
    assert.deepEqual([done.stopped, done.notWhole, answered(done)], [undefined, true, []]);
    assert.deepEqual([(await itemOf(box, 'notes'))!.on, (await itemOf(box, 'notes'))!.source], [true, id]);
    const row = (await sourcesView(box.context, box.tools)).sources[0];
    assert.deepEqual([row.unread, row.problem, row.names.map(name => [name.key, name.state, !!name.there])], [why, undefined, [['notes', 'nothing', false]]], 'its row says why, and still names what came from it');
  } finally { await box.cleanup(); }
});

test('The repo Pull and Push use is refused as a source, and so is a link that is a source already', async () => {
  const box = await sandbox();
  try {
    const repo = await repository(hosts, 'https://github.com/me/config');
    await repo.commit({ 'skills/notes/SKILL.md': skillMd('notes') });
    const { mkdir, writeFile } = await import('node:fs/promises');
    await mkdir(join(box.home, '.central-knot'), { recursive: true });
    await writeFile(join(box.home, '.central-knot/repo.json'), JSON.stringify({ url: 'git@github.com:me/config.git', branch: 'main' }));
    assert.equal((await previewSource(box.context, box.tools, 'https://github.com/me/config/tree/main/skills/notes')).refused, 'That is the Git repo Pull and Push use here, so it can’t be a source too. A source is only ever read; that repo stays on the Git repo page.');
    await rm(join(box.home, '.central-knot/repo.json'));
    await add(box, 'me/config');
    assert.equal((await previewSource(box.context, box.tools, 'https://github.com/me/config.git')).refused, 'That link is a source already: its row is below.');
  } finally { await box.cleanup(); }
});

// ---------- The fetch ----------

test('The fetch fails: no repository there, or its branch deleted later: the look is refused, a check changes nothing and its row says why', async () => {
  const box = await sandbox();
  try {
    assert.match((await previewSource(box.context, box.tools, 'https://github.com/nobody/nothing')).refused ?? '', /No access, or no repository there|Can’t reach the source/);
    const repo = await repository(hosts, 'https://github.com/team/kit');
    await repo.commit({ 'notes/SKILL.md': skillMd('notes') });
    repo.branch('topic');
    await add(box, 'https://github.com/team/kit/tree/topic');
    const id = await sourceId(box);
    repo.branch('main', false);
    repo.git('branch', '-D', 'topic');
    const done = await check(box, id);
    assert.equal(done.stopped, 'Couldn’t read github.com/team/kit (topic). The source has no branch or tag by that name now.');
    assert.deepEqual([(await itemOf(box, 'notes'))!.source, (await sourcesView(box.context, box.tools)).sources[0].problem], [id, 'The source has no branch or tag by that name now.']);
  } finally { await box.cleanup(); }
});

test('Two checks at once, and Remove during a check: each check’s fetch waits for its turn; one whose source was removed meanwhile changes nothing', async () => {
  const box = await sandbox();
  try {
    const { repo, id } = await oneSkill(box, 'notes');
    await repo.commit({ 'SKILL.md': skillMd('notes', 'Second.') }, '2026-11-02T10:00:00Z');
    let queue: Promise<unknown> = Promise.resolve();
    const turn = <T>(work: () => Promise<T>) => { const next = queue.then(work); queue = next.catch(() => undefined); return next; };
    const [first, second] = await Promise.all([checkSource(box.context, now(box), id, turn), checkSource(box.context, now(box), id, turn)]);
    // Whichever fetch ends first takes its turn first; the other finds its work done.
    assert.deepEqual([answered(first), answered(second)].sort((one, two) => two!.length - one!.length), [[{ name: 'notes', answer: 'update' }], []]);
    assert.equal((await readHistory(box.context)).filter(event => event.cause === 'source' && event.kind === 'edit').length, 1);

    await repo.commit({ 'SKILL.md': skillMd('notes', 'Third.') });
    let release!: () => void;
    queue = new Promise<void>(done => { release = done; });
    const checking = checkSource(box.context, now(box), id, turn);
    await new Promise(done => setTimeout(done, 300));
    const removed = turn(() => removeSource(box.context, box.tools, id));
    release();
    assert.equal((await checking).stopped, undefined, 'the check took its turn first');
    await removed;
    assert.deepEqual([(await sourcesView(box.context, box.tools)).sources, await bodyOf(box, 'notes')], [[], 'Third.']);

    const { id: again } = await oneSkill(box, 'other');
    queue = new Promise<void>(done => { release = done; });
    const removing = turn(() => removeSource(box.context, box.tools, again));
    const late = checkSource(box.context, now(box), again, turn);
    release();
    await removing;
    assert.equal((await late).stopped, 'That source was removed meanwhile. Nothing was changed.');
  } finally { await box.cleanup(); }
});

test('Remove: each item it brought stays as it is, On or Off, with its versions, and reads as not linked', async () => {
  const box = await sandbox();
  try {
    const { id } = await oneSkill(box, 'notes', { on: true });
    const before = [await itemOf(box, 'notes'), await everywhere(box)];
    await removeSource(box.context, box.tools, id);
    assert.deepEqual([await itemOf(box, 'notes'), await everywhere(box)], before, 'nothing about the item is written');
    assert.deepEqual([(await sourcesView(box.context, box.tools)).sources, (await seen(box)).fact?.fromSource], [[], undefined], 'and its row no longer names a source');
    // Linked to a source that is no longer recorded: a new source with the same name and content links it again.
    const { added } = await add(box, 'https://github.com/team/notes');
    assert.deepEqual(answered(added), [{ name: 'notes', answer: 'link' }]);
  } finally { await box.cleanup(); }
});

// ---------- Another feature moves the same item ----------

test('Push sends a skill from a source like any other, Off or On, without its link; Pull on the same home then changes nothing, and on another home it comes in as Pull brings any item, not linked', async () => {
  const { world } = await import('./gitrepo-world.ts');
  const { connectRepo, pushRepo, pullRepo } = await import('../src/gitrepo.ts');
  const box = await world();
  try {
    const first = await box.home('first');
    const repo = await repository(hosts, 'https://github.com/team/notes');
    await repo.commit({ 'SKILL.md': skillMd('notes') });
    const look = await previewSource(first, ['claude-cli', 'copilot-cli'], 'team/notes') as Extract<SourcePreview, { token: string }>;
    await addSource(first, ['claude-cli', 'copilot-cli'], look.token);
    await connectRepo(first, box.remote, '');
    assert.equal((await pushRepo(first)).stopped, undefined);
    const { git } = await import('./gitrepo-world.ts');
    assert.match(git(box.remote, 'ls-tree', '-r', '--name-only', 'main'), /^skills\/notes\/SKILL\.md$/m, 'the Off item is in the repo, as every library item is');
    const before = JSON.parse(await readFile(join(first.home, '.central-knot/skills.json'), 'utf8')).items.notes;
    await pullRepo(first);
    assert.deepEqual(JSON.parse(await readFile(join(first.home, '.central-knot/skills.json'), 'utf8')).items.notes, before, 'Pull on the same home changes nothing about it');
    const second = await box.home('second');
    await connectRepo(second, box.remote, '');
    await pullRepo(second);
    const pulled = JSON.parse(await readFile(join(second.home, '.central-knot/skills.json'), 'utf8')).items.notes;
    assert.deepEqual([pulled.on, pulled.source, pulled.versions.map((version: { from: { how: string } }) => version.from.how)], [true, undefined, ['pulled']]);
  } finally { await box.cleanup(); }
});

test('Synchronize everything finding a copy of a source’s Off skill in a tool: it is in the library, so not found and not taken in; first setup’s answer stays absent and its one Undo leaves it', async () => {
  const { readRecord } = await import('../src/share.ts');
  const { setSyncEverything, everythingEntryAction } = await import('../src/everything.ts');
  const box = await sandbox();
  try {
    await oneSkill(box, 'notes');
    assert.equal((await readRecord(box.home)).record?.syncEverything, undefined, 'adding a source in a home never asked leaves the answer absent');
    await put(box, 'claude-cli', { 'SKILL.md': skillMd('notes', 'Mine.') });
    await setSyncEverything(box.context, true, true);
    await applySkills(box.context, box.tools, [], { background: true });
    const item = (await itemOf(box, 'notes'))!;
    assert.deepEqual([item.on, item.versions.length, (await seen(box)).fact?.takeInAnswers], [false, 1, undefined], 'not found: the item is Off, its copy in Claude Code its own, left alone');
    const switchOn = (await readHistory(box.context)).find(event => event.kind === 'everything')!;
    await everythingEntryAction(box.context, box.tools, switchOn.id);
    assert.deepEqual([(await itemOf(box, 'notes'))!.deleted, (await itemOf(box, 'notes'))!.source !== undefined], [undefined, true], 'the one Undo takes back only what the rule took in');
  } finally { await box.cleanup(); }
});

test('A profile that includes a source’s skill is in use while it is On; the source dropping it turns it Off as any Off does, and the profile is no longer in use', async () => {
  const { saveProfile, readProfiles, readLibraries } = await import('../src/profiles.ts');
  const { inUse, liveItems } = await import('../src/profileplan.ts');
  const box = await sandbox();
  try {
    const { repo, id } = await oneSkill(box, 'notes', { on: true });
    await saveProfile(box.context, { name: 'Writing', items: ['skill:notes'] });
    const used = async () => { const libraries = await readLibraries(box.context); return 'stop' in libraries ? [] : inUse((await readProfiles(box.home)).profiles, liveItems(libraries.libraries)).map(profile => profile.name); };
    assert.deepEqual(await used(), ['Writing']);
    await repo.commit({ 'SKILL.md': null, 'other/SKILL.md': skillMd('other') });
    await check(box, id);
    assert.deepEqual(await used(), []);
  } finally { await box.cleanup(); }
});

test('A tool left out: a source’s skill turned On reaches the managed tools only, and nothing of it reaches the one left out', async () => {
  const { chooseTools } = await import('../src/toolchoice.ts');
  const box = await sandbox();
  try {
    const { repo, id } = await oneSkill(box, 'notes');
    await chooseTools(box.context, 'codex-cli', false);
    const managed = box.tools.filter(tool => tool !== 'codex-cli');
    await applySkills(box.context, managed, [{ key: 'notes', on: true, except: [], seenOn: false }]);
    await repo.commit({ 'SKILL.md': skillMd('notes', 'Second.') });
    await checkSource(box.context, async () => managed, id, inTurn);
    const there = await everywhere(box);
    assert.deepEqual([await toolBody(box, 'claude-cli', 'notes'), await toolBody(box, 'copilot-cli', 'notes'), there['codex-cli']], ['Second.', 'Second.', undefined]);
  } finally { await box.cleanup(); }
});

test('A home from before sources: nothing recorded, the Sources page is empty and every item reads as not linked', async () => {
  const box = await sandbox();
  try {
    await put(box, 'claude-cli');
    await applySkills(box.context, box.tools, [{ key: 'notes', on: true, except: [], seenOn: false }]);
    assert.deepEqual([(await sourcesView(box.context, box.tools)).sources, (await itemOf(box, 'notes'))!.source, (await seen(box)).fact?.fromSource], [[], undefined, undefined]);
    assert.equal(await readFile(join(box.home, '.central-knot/sources.json'), 'utf8').catch(() => 'none'), 'none', 'and nothing is written for sources');
  } finally { await box.cleanup(); }
});

// ---------- Found by the reviewers: each was a sequence that ended wrong ----------

test('A source removed and added again: a skill unchanged since that link gave it is linked again, and the link’s change comes in', async () => {
  const box = await sandbox();
  try {
    const { repo, id, link } = await oneSkill(box, 'notes', { on: true });
    await removeSource(box.context, box.tools, id);
    await repo.commit({ 'SKILL.md': skillMd('notes', 'Second.') }, '2026-11-02T10:00:00Z');
    const look = await previewSource(box.context, box.tools, link) as Extract<SourcePreview, { token: string }>;
    assert.deepEqual(look.names.map(name => [name.name, name.state]), [['notes', 'update']], 'Add links it again, and the source’s version becomes current');
    assert.deepEqual(answered(await addSource(box.context, box.tools, look.token)), [{ name: 'notes', answer: 'update' }]);
    assert.equal(await bodyOf(box, 'notes'), 'Second.');
    for (const tool of box.tools) assert.equal(await toolBody(box, tool, 'notes'), 'Second.');
    assert.deepEqual((await sourcesView(box.context, box.tools)).sources[0].names.map(name => [name.name, name.state]), [['notes', 'nothing']]);
  } finally { await box.cleanup(); }
});

test('A one-skill source whose SKILL.md stops parsing: Check now keeps that read, nothing turns Off, and the row says why for the skill it can’t read', async () => {
  const box = await sandbox();
  try {
    const { repo, id } = await oneSkill(box, 'notes', { on: true });
    await repo.commit({ 'SKILL.md': '---\nname: [notes\n---\nBroken.\n' }, '2026-11-07T10:00:00Z');
    const done = await check(box, id), row = (await sourcesView(box.context, box.tools)).sources[0];
    const why = 'its SKILL.md can’t be read as a skill (Malformed YAML frontmatter)';
    assert.deepEqual([done.stopped, done.notWhole, row.unread], [undefined, true, undefined]);
    assert.deepEqual(row.names.map(name => [name.key, name.state, name.why]), [['notes', 'unreadable', why]], 'said once, on the skill’s own line');
    assert.equal((await itemOf(box, 'notes'))!.on, true);
  } finally { await box.cleanup(); }
});

test('A copy deleted by hand that no pass has seen yet (Automatic sync off), then Check now on a source whose SKILL.md stopped parsing: the check’s pass turns the skill Off for the deletion, as any pass would; the source answers nothing, and History names the deletion', async () => {
  const box = await sandbox();
  try {
    // Named apart from its repository, so its broken SKILL.md is a nameless skill there and notes is missing: not read whole.
    const { repo, id } = await oneSkill(box, 'team-notes', { skill: 'notes', on: true });
    await rm(folderOf(box, 'codex-cli'), { recursive: true });
    await repo.commit({ 'SKILL.md': '---\nname: [notes\n---\nBroken.\n' }, '2026-11-07T10:00:00Z');
    const done = await check(box, id);
    assert.deepEqual([answered(done), done.notWhole, (await itemOf(box, 'notes'))!.on], [[], true, false]);
    assert.deepEqual((await sentences(box, 'notes')).at(-1), 'Its copy was deleted in Codex, so it was turned off and removed from Claude Code and Copilot CLI. Central Knot keeps it.');
  } finally { await box.cleanup(); }
});

test('A source can’t also be the Git repo Pull and Push use, either way round, in words that match', async () => {
  const { connectRepo } = await import('../src/gitrepo.ts');
  const box = await sandbox();
  try {
    await oneSkill(box, 'kit', { skill: 'notes' });
    const said = await connectRepo(box.context, 'git@github.com:team/kit.git', '');
    assert.equal(said.stopped, 'That repo is a source here, so it can’t be the Git repo Pull and Push use too. A source is only ever read; that repo stays on the Sources page.');
    assert.equal(await readFile(join(box.home, '.central-knot/repo.json'), 'utf8').catch(() => 'none'), 'none', 'nothing is connected');
  } finally { await box.cleanup(); }
});

test('A link that names no branch reads the repository’s default branch, recorded by its name; a repository that names no default is refused in plain words', async () => {
  const box = await sandbox();
  try {
    const repo = await repository(hosts, 'https://github.com/team/trunk', 'trunk');
    await repo.commit({ 'SKILL.md': skillMd('trunk') });
    const look = await previewSource(box.context, box.tools, 'team/trunk') as Extract<SourcePreview, { token: string }>;
    assert.equal(look.ref, 'trunk');
    await addSource(box.context, box.tools, look.token);
    assert.equal((await sourcesView(box.context, box.tools)).sources[0].ref, 'trunk');
    repo.git('checkout', '--quiet', '--detach');
    assert.equal((await previewSource(box.context, box.tools, 'https://github.com/team/trunk.git/')).refused, 'The repository doesn’t say which branch is its default. Paste a link to the branch (…/tree/<branch>).');
  } finally { await box.cleanup(); }
});

test('The link forms people paste: a link to the skill’s own SKILL.md reads the folder that holds it, and github.com/owner/repo needs no https://', async () => {
  const repo = await repository(hosts, 'https://github.com/stephenturner/skill-deslop');
  await repo.commit(deslopFiles());
  const box = await sandbox();
  try {
    for (const link of ['https://github.com/stephenturner/skill-deslop/blob/main/SKILL.md', 'github.com/stephenturner/skill-deslop']) {
      const look = await previewSource(box.context, box.tools, link) as Extract<SourcePreview, { token: string }>;
      assert.deepEqual([look.refused, look.ref, look.folder, look.names.map(name => name.name)], [undefined, 'main', '', ['deslop']], link);
    }
  } finally { await box.cleanup(); }
});

test('Check now concerns its source’s skills and nothing else: an edit waiting in another skill (Automatic sync off) stays waiting', async () => {
  const box = await sandbox();
  try {
    await put(box, 'claude-cli', { 'SKILL.md': skillMd('mine', 'Mine.') }, [], 'mine');
    await applySkills(box.context, box.tools, [{ key: 'mine', on: true, except: [], seenOn: false }]);
    const { repo, id } = await oneSkill(box, 'notes');
    await put(box, 'codex-cli', { 'SKILL.md': skillMd('mine', 'Edited in Codex, not taken in yet.') }, [], 'mine');
    await repo.commit({ 'SKILL.md': skillMd('notes', 'Second.') });
    await check(box, id);
    assert.equal(await bodyOf(box, 'notes'), 'Second.');
    assert.equal(await bodyOf(box, 'mine'), 'Mine.', 'the other skill’s edit is not taken in by the source’s pass');
    assert.equal(await toolBody(box, 'claude-cli', 'mine'), 'Mine.');
  } finally { await box.cleanup(); }
});

test('In a home another build of Central Knot syncs, a source’s Look, Check now and Remove are refused at the gate, and nothing changes', async () => {
  const { readRecord, saveRecord } = await import('../src/share.ts');
  const box = await sandbox();
  try {
    const { id } = await oneSkill(box, 'notes');
    const { record } = await readRecord(box.home);
    await saveRecord(box.home, { ...record!, owner: 'com.example.another-build', ownerName: 'Another build' }, true);
    const refused = [(await previewSource(box.context, box.tools, 'team/notes')).refused, (await check(box, id)).stopped, (await removeSource(box.context, box.tools, id)).stopped];
    assert.ok(refused.every(said => /Another build/.test(said ?? '')), JSON.stringify(refused));
    assert.equal((await sourcesView(box.context, box.tools)).sources.length, 1, 'the source is still recorded');
  } finally { await box.cleanup(); }
});

test('Look at a repository, connect it as the Git repo, then Add: Add refuses it, as Look would now, and nothing becomes a source', async () => {
  const { connectRepo } = await import('../src/gitrepo.ts');
  const box = await sandbox();
  try {
    const repo = await repository(hosts, 'https://github.com/me/config');
    await repo.commit({ 'skills/notes/SKILL.md': skillMd('notes') });
    const look = await previewSource(box.context, box.tools, 'me/config') as Extract<SourcePreview, { token: string }>;
    assert.equal((await connectRepo(box.context, 'https://github.com/me/config.git', '')).stopped, undefined);
    const added = await addSource(box.context, box.tools, look.token);
    assert.equal(added.stopped, 'That is the Git repo Pull and Push use here, so it can’t be a source too. A source is only ever read; that repo stays on the Git repo page.');
    assert.deepEqual([(await sourcesView(box.context, box.tools)).sources, await itemOf(box, 'notes')], [[], undefined]);
  } finally { await box.cleanup(); }
});

test('The owner’s example, its SKILL.md stopped parsing at the source: one line, deslop at the root of skill-deslop, says it can’t be read', async () => {
  const repo = await repository(hosts, 'https://github.com/stephenturner/skill-deslop');
  await repo.commit(deslopFiles());
  const box = await sandbox();
  try {
    await add(box, DESLOP);
    await repo.commit({ 'SKILL.md': '---\nname: [deslop\n---\nBroken.\n' });
    await check(box, await sourceId(box));
    const row = (await sourcesView(box.context, box.tools)).sources[0];
    assert.deepEqual(row.names.map(name => [name.name, name.there?.folderName, name.state]), [['deslop', 'skill-deslop', 'unreadable']]);
  } finally { await box.cleanup(); }
});
