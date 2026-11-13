// Sources, on real folders and made-up Git repositories standing in for links (tests/sourcerepo.ts: nothing reaches the
// network): the owner's example first, then each row of the source's table (library.ts A SOURCE) and each way it goes wrong,
// one worked example each. The table itself, row by row, is in tests/library.test.ts.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { readHistory } from '../src/history.ts';
import { libraryAction, librarySentence } from '../src/historyactions.ts';
import { libraryWords } from '../src/libraryrow.ts';
import { addSource, bringBack, checkSource, previewSource, removeSource, sourcesView } from '../src/sources.ts';
import type { SourcePreview } from '../src/types.ts';
import { bytes, everywhere, folderOf, itemOf, put, sandbox, seen, skillText, type Box } from './skillclicks.ts';
import { applySkills } from '../src/skills.ts';
import { deslopFiles, repository, skillMd, standInHosts } from './sourcerepo.ts';

const hosts = await standInHosts();
test.after(() => hosts.cleanup());

const DESLOP = 'https://github.com/stephenturner/skill-deslop/tree/main';
const now = (box: Box) => async () => box.tools;
const inTurn = <T>(work: () => Promise<T>) => work();
/** Looks at a link, then adds it: what the page's Look then Add do. */
async function add(box: Box, link: string) {
  const look = await previewSource(box.context, link);
  assert.ok('token' in look && !look.refused, `the look is refused: ${look.refused}`);
  return { look, added: await addSource(box.context, box.tools, look.token) };
}
const check = (box: Box, id: string) => checkSource(box.context, now(box), id, inTurn);
const sourceId = async (box: Box) => (await sourcesView(box.context)).sources[0].id;
const sentences = async (box: Box, key = 'deslop') => {
  const item = await itemOf(box, key);
  return (await readHistory(box.context)).filter(event => event.key === key).map(event => librarySentence(event, libraryWords.skills, box.tools, item)?.text);
};

test('The owner’s example: a link to a repository whose root is one skill offers deslop with every file beside its SKILL.md; Add puts it in Central Knot, Off; On gives every tool all of it, byte for byte', async () => {
  const repo = await repository(hosts, 'https://github.com/stephenturner/skill-deslop');
  await repo.commit(deslopFiles(), '2026-11-01T10:00:00Z');
  const box = await sandbox();
  try {
    const look = await previewSource(box.context, DESLOP) as Extract<SourcePreview, { token: string }>;
    assert.equal(look.refused, undefined);
    assert.deepEqual([look.holds, look.ref, look.folder], ['skills', 'main', '']);
    assert.deepEqual(look.names.map(name => [name.name, name.folder, name.folderName, name.state]), [['deslop', '', 'skill-deslop', 'make']], 'named as its SKILL.md names it, the repository’s name beside it');
    assert.deepEqual(look.names[0].files, ['.gitignore', 'LICENSE', 'README.md', 'SKILL.md', 'references/checklist.md', 'references/examples.md', 'references/phrases.md', 'references/structures.md']);
    assert.deepEqual(await everywhere(box, 'deslop'), { 'claude-cli': undefined, 'copilot-cli': undefined, 'codex-cli': undefined, 'opencode-cli': undefined, 'pi-cli': undefined }, 'a look writes no tool');
    assert.equal(await itemOf(box, 'deslop'), undefined, 'and keeps nothing in the library');

    const added = await addSource(box.context, box.tools, look.token);
    assert.equal(added.stopped, undefined);
    assert.deepEqual(added.sourced, [{ name: 'deslop', answer: 'make' }]);
    const item = (await itemOf(box, 'deslop'))!;
    assert.deepEqual([item.on, item.versions.map(version => [version.from.how, version.from.link, version.at])], [false, [['source', DESLOP, '2026-11-01T10:00:00.000Z']]]);
    assert.deepEqual(Object.values(await everywhere(box, 'deslop')).filter(Boolean), [], 'Off: in no tool');
    assert.deepEqual(await sentences(box), ['Brought in from github.com/stephenturner/skill-deslop (main): in Central Knot, Off, until you turn it on.']);
    const view = (await sourcesView(box.context)).sources[0];
    assert.deepEqual([view.link, view.names.map(name => [name.name, name.state, name.on])], [DESLOP, [['deslop', 'in', false]]]);

    const { row } = await seen(box, box.context, 'deslop');
    await applySkills(box.context, box.tools, [{ key: 'deslop', managed: true, off: [], seenManaged: false }]);
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
  if (on) await applySkills(box.context, box.tools, [{ key: skill, managed: true, off: [], seenManaged: false }]);
  return { repo, link, id: (await sourcesView(box.context)).sources.find(source => source.link === link)!.id };
}
const bodyOf = async (box: Box, key: string) => { const item = (await itemOf(box, key))!; return (await readFile(join(box.home, '.central-knot/items/skills', key, 'versions', item.hash, 'SKILL.md'), 'utf8')).trim().split('\n').at(-1); };
const toolBody = async (box: Box, tool: string, key: string) => (await readFile(join(folderOf(box, tool as never, key), 'SKILL.md'), 'utf8').catch(() => undefined))?.trim().split('\n').at(-1);

test('S = seen: Check now with nothing new at the source changes nothing, and tells History nothing', async () => {
  const box = await sandbox();
  try {
    const { id } = await oneSkill(box, 'notes');
    const before = [await itemOf(box, 'notes'), (await readHistory(box.context)).length];
    const done = await check(box, id);
    assert.deepEqual([done.stopped, done.sourced], [undefined, []]);
    assert.deepEqual([await itemOf(box, 'notes'), (await readHistory(box.context)).length], before);
  } finally { await box.cleanup(); }
});

test('S changed, current = seen: the source’s content becomes current, Off stays Off and no tool is written; its entry’s Undo makes the one before current again', async () => {
  const box = await sandbox();
  try {
    const { repo, id } = await oneSkill(box, 'notes');
    await repo.commit({ 'SKILL.md': skillMd('notes', 'Second.') }, '2026-11-02T10:00:00Z');
    const done = await check(box, id);
    assert.deepEqual(done.sourced, [{ name: 'notes', answer: 'update' }]);
    const item = (await itemOf(box, 'notes'))!;
    assert.deepEqual([item.on, await bodyOf(box, 'notes'), item.versions.map(version => version.at)], [false, 'Second.', ['2026-11-02T10:00:00.000Z', '2026-11-01T10:00:00.000Z']]);
    assert.deepEqual(Object.values(await everywhere(box)).filter(Boolean), []);
    assert.equal((await sentences(box, 'notes')).at(-1), 'Updated from github.com/team/notes; that became the current version.');
    const entry = (await readHistory(box.context)).at(-1)!;
    const undo = libraryAction(entry, item, { managed: box.tools, pending: [] })!;
    assert.equal(undo.label, 'Undo');
    await applySkills(box.context, box.tools, [undo.change]);
    assert.equal(await bodyOf(box, 'notes'), 'First.');
    assert.deepEqual((await check(box, id)).sourced, [], 'the source has not changed since, so the next check leaves the Undo as it is');
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
async function editHere(box: Box, key: string, body: string, when: string) {
  const folder = folderOf(box, 'claude-cli', key);
  await put(box, 'claude-cli', { 'SKILL.md': skillMd(key, body) }, [], key);
  const { utimes } = await import('node:fs/promises');
  for (const path of [join(folder, 'SKILL.md'), folder]) await utimes(path, new Date(when), new Date(when));
  await applySkills(box.context, box.tools, []);
}

test('Both changed, the source later: its content is current and the edit made here is kept as a version', async () => {
  const box = await sandbox();
  try {
    const { repo, id } = await oneSkill(box, 'notes', { on: true });
    await editHere(box, 'notes', 'Mine.', '2026-11-03T10:00:00Z');
    await repo.commit({ 'SKILL.md': skillMd('notes', 'Theirs.') }, '2026-11-04T10:00:00Z');
    assert.deepEqual((await check(box, id)).sourced, [{ name: 'notes', answer: 'update' }]);
    assert.equal(await bodyOf(box, 'notes'), 'Theirs.');
    assert.ok((await itemOf(box, 'notes'))!.versions.some(version => version.from.how === 'edited'), 'the edit is a version');
    for (const tool of box.tools) assert.equal(await toolBody(box, tool, 'notes'), 'Theirs.');
  } finally { await box.cleanup(); }
});

test('Both changed, the edit here later: it stays current, the source’s is kept as a version with its own Use it; a tie keeps the current one too', async () => {
  const box = await sandbox();
  try {
    const { repo, id } = await oneSkill(box, 'notes', { on: true });
    await editHere(box, 'notes', 'Mine.', '2026-11-05T10:00:00Z');
    await repo.commit({ 'SKILL.md': skillMd('notes', 'Theirs.') }, '2026-11-04T10:00:00Z');
    assert.deepEqual((await check(box, id)).sourced, [{ name: 'notes', answer: 'keep' }]);
    assert.equal(await bodyOf(box, 'notes'), 'Mine.');
    assert.equal((await sentences(box, 'notes')).at(-1), 'github.com/team/notes changed it too, but the current version is later, so the source’s is kept as a version.');
    const kept = (await readHistory(box.context)).at(-1)!, item = (await itemOf(box, 'notes'))!;
    const use = libraryAction(kept, item, { managed: box.tools, pending: [] })!;
    assert.equal(use.label, 'Use it');
    await applySkills(box.context, box.tools, [use.change]);
    for (const tool of box.tools) assert.equal(await toolBody(box, tool, 'notes'), 'Theirs.');

    await editHere(box, 'notes', 'Mine again.', '2026-11-06T10:00:00Z');
    await repo.commit({ 'SKILL.md': skillMd('notes', 'Theirs again.') }, '2026-11-06T10:00:00.500Z');
    assert.deepEqual((await check(box, id)).sourced, [{ name: 'notes', answer: 'keep' }], 'half a second apart is a tie: the current one stays');
    assert.equal(await bodyOf(box, 'notes'), 'Mine again.');
  } finally { await box.cleanup(); }
});

test('The named weakness: an edit here on Tuesday, the source’s edit of the skill on Monday, then an unrelated commit there on Wednesday: the source’s Monday edit counts as the latest', async () => {
  const box = await sandbox();
  try {
    const { repo, id } = await oneSkill(box, 'notes', { on: true });
    await repo.commit({ 'SKILL.md': skillMd('notes', 'Monday’s.') }, '2026-11-09T10:00:00Z');
    await editHere(box, 'notes', 'Tuesday’s.', '2026-11-10T10:00:00Z');
    await repo.commit({ 'README.md': 'Unrelated.\n' }, '2026-11-11T10:00:00Z');
    assert.deepEqual((await check(box, id)).sourced, [{ name: 'notes', answer: 'update' }]);
    assert.equal(await bodyOf(box, 'notes'), 'Monday’s.', 'the source’s time is its head commit’s, Wednesday');
    assert.ok((await itemOf(box, 'notes'))!.versions.some(version => version.from.how === 'edited'), 'Tuesday’s edit is kept as a version, one click from current');
  } finally { await box.cleanup(); }
});

test('Edited in a tool with Automatic sync off, then Check now: the later of the edit and the source’s content wins, and the other is kept', async () => {
  const box = await sandbox();
  try {
    const { repo, id } = await oneSkill(box, 'notes', { on: true });
    // Sync off: nothing takes the edit in before the check.
    await put(box, 'codex-cli', { 'SKILL.md': skillMd('notes', 'Edited in Codex.') });
    const { utimes } = await import('node:fs/promises');
    for (const path of [join(folderOf(box, 'codex-cli'), 'SKILL.md'), folderOf(box, 'codex-cli')]) await utimes(path, new Date('2026-11-08T10:00:00Z'), new Date('2026-11-08T10:00:00Z'));
    await repo.commit({ 'SKILL.md': skillMd('notes', 'From the source.') }, '2026-11-07T10:00:00Z');
    await check(box, id);
    assert.equal(await bodyOf(box, 'notes'), 'Edited in Codex.', 'the edit was later');
    for (const tool of box.tools) assert.equal(await toolBody(box, tool, 'notes'), 'Edited in Codex.');
    const how = (await itemOf(box, 'notes'))!.versions.map(version => version.from.how);
    assert.ok(how.includes('source') && how.includes('edited'), JSON.stringify(how));
  } finally { await box.cleanup(); }
});

test('Gone, read whole: a skill renamed at the source turns Off once, said in History, and is no longer linked; turned back On, the next check leaves it On, and the new name comes in Off', async () => {
  const box = await sandbox();
  try {
    const { repo, id } = await oneSkill(box, 'notes', { on: true });
    await repo.commit({ 'SKILL.md': skillMd('jottings', 'First.') }, '2026-11-02T10:00:00Z');
    const done = await check(box, id);
    assert.deepEqual(done.sourced, [{ name: 'jottings', answer: 'make' }, { name: 'notes', answer: 'drop' }]);
    const item = (await itemOf(box, 'notes'))!;
    assert.deepEqual([item.on, item.source, item.seen], [false, undefined, undefined]);
    assert.deepEqual(Object.values(await everywhere(box)).filter(Boolean), [], 'removed from every tool, kept in Central Knot');
    assert.equal((await sentences(box, 'notes')).at(-1), 'github.com/team/notes no longer has it, so it is off and removed from all 3 tools, and no longer from that source. Central Knot keeps it.');
    const turnOn = libraryAction((await readHistory(box.context)).filter(event => event.key === 'notes').at(-1)!, item, { managed: box.tools, pending: [] })!;
    assert.equal(turnOn.label, 'Turn on');
    await applySkills(box.context, box.tools, [turnOn.change]);
    assert.deepEqual((await check(box, id)).sourced, [], 'the next check leaves it');
    assert.equal((await itemOf(box, 'notes'))!.on, true);
    assert.deepEqual([(await itemOf(box, 'jottings'))!.on, (await itemOf(box, 'jottings'))!.source], [false, id]);
  } finally { await box.cleanup(); }
});

test('Turned Off, then the source updates it: it stays Off and the new content is current', async () => {
  const box = await sandbox();
  try {
    const { repo, id } = await oneSkill(box, 'notes', { on: true });
    await applySkills(box.context, box.tools, [{ key: 'notes', managed: false, off: [], seenManaged: true }]);
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
    await applySkills(box.context, box.tools, ['same', 'review'].map(key => ({ key, managed: true, off: [], seenManaged: false })));
    const before = await everywhere(box, 'review');
    const repo = await repository(hosts, 'https://github.com/team/kit');
    await repo.commit({ 'same/SKILL.md': skillMd('same', 'Same.'), 'review/SKILL.md': skillMd('review', 'Their review.'), 'fresh/SKILL.md': skillMd('fresh') });
    const look = await previewSource(box.context, 'https://github.com/team/kit') as Extract<SourcePreview, { token: string }>;
    assert.deepEqual(look.names.map(name => [name.name, name.state]), [['fresh', 'make'], ['review', 'differs'], ['same', 'link']]);
    const { added } = { added: await addSource(box.context, box.tools, look.token) };
    assert.deepEqual(added.sourced, [{ name: 'fresh', answer: 'make' }, { name: 'review', answer: 'differs' }, { name: 'same', answer: 'link' }]);
    const id = await sourceId(box);
    assert.deepEqual([(await itemOf(box, 'same'))!.source, (await itemOf(box, 'same'))!.on, (await itemOf(box, 'review'))!.source], [id, true, undefined]);
    assert.deepEqual(await everywhere(box, 'review'), before, 'the person’s own review is as it was in every tool');
    assert.deepEqual((await sourcesView(box.context)).sources[0].names.map(name => [name.name, name.state]), [['fresh', 'in'], ['review', 'differs'], ['same', 'in']]);
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
    const look = await previewSource(box.context, 'https://github.com/other/notes') as Extract<SourcePreview, { token: string }>;
    assert.deepEqual(look.names.map(name => [name.state, name.why]), [['another', link]]);
  } finally { await box.cleanup(); }
});

test('A skill deleted from Central Knot: the tombstone holds at Check now and at Add; Add on its row brings it back, Off, at the source’s version', async () => {
  const box = await sandbox();
  try {
    const { repo, id } = await oneSkill(box, 'notes', { on: true });
    await applySkills(box.context, box.tools, [{ key: 'notes', managed: true, off: [], seenManaged: true, deleted: true }]);
    await repo.commit({ 'SKILL.md': skillMd('notes', 'Second.') });
    assert.deepEqual((await check(box, id)).sourced, [{ name: 'notes', answer: 'deleted' }]);
    assert.ok((await itemOf(box, 'notes'))!.deleted, 'still deleted');
    assert.deepEqual((await sourcesView(box.context)).sources[0].names.map(name => name.state), ['deleted']);
    const back = await bringBack(box.context, box.tools, id, 'notes');
    assert.deepEqual(back.sourced, [{ name: 'notes', answer: 'make' }]);
    const item = (await itemOf(box, 'notes'))!;
    assert.deepEqual([item.deleted, item.on, item.source, await bodyOf(box, 'notes')], [undefined, false, id, 'Second.']);
    assert.ok(item.versions.length >= 2, 'its earlier versions come back with it');
  } finally { await box.cleanup(); }
});

// ---------- What is at a link ----------

test('A link to a plugin, or a marketplace, is named as that and nothing there is read; a folder of loose skills beside agent files brings the skills and names the agents', async () => {
  const box = await sandbox();
  try {
    const plugin = await repository(hosts, 'https://github.com/team/plugin');
    await plugin.commit({ '.claude-plugin/plugin.json': '{"name":"plugin"}', 'skills/pdf/SKILL.md': skillMd('pdf') });
    const said = await previewSource(box.context, 'https://github.com/team/plugin');
    assert.deepEqual(['holds' in said && said.holds, said.refused], ['plugin', 'The link holds a plugin (a .claude-plugin or .codex-plugin folder). Plugins from a link come in a later version; nothing here is read.']);
    const market = await repository(hosts, 'https://github.com/team/market');
    await market.commit({ '.agents/plugins/marketplace.json': '{}' });
    assert.match((await previewSource(box.context, 'https://github.com/team/market')).refused ?? '', /holds a marketplace/);

    const loose = await repository(hosts, 'https://github.com/team/loose');
    await loose.commit({ 'pdf/SKILL.md': skillMd('pdf'), 'docx/SKILL.md': skillMd('docx'), 'agents/writer.md': '---\nname: writer\n---\nWrite.\n', 'commands/go.md': 'Go.\n' });
    const look = await previewSource(box.context, 'https://github.com/team/loose') as Extract<SourcePreview, { token: string }>;
    assert.deepEqual([look.refused, look.names.map(name => name.name), look.later], [undefined, ['docx', 'pdf'], ['1 agent file: agents come in a later version']]);
  } finally { await box.cleanup(); }
});

test('Central Knot’s own layout given as a link: its skills come in, Off; its agents, MCP servers and base instructions are named, not read', async () => {
  const box = await sandbox();
  try {
    const repo = await repository(hosts, 'https://github.com/me/agent-config');
    await repo.commit({ 'skills/notes/SKILL.md': skillMd('notes'), 'mcp/github.json': '{"command":"gh"}', 'agents/writer.md': '---\nname: writer\n---\nWrite.\n', 'instructions/base.md': 'Be brief.\n' });
    const look = await previewSource(box.context, 'me/agent-config') as Extract<SourcePreview, { token: string }>;
    assert.deepEqual([look.names.map(name => [name.name, name.folder]), look.later], [[['notes', 'skills/notes']], ['1 agent file: agents come in a later version', 'MCP servers: they come in a later version', 'base instructions: they come only from your own Git repo, by Pull']]);
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
    const look = await previewSource(box.context, 'https://github.com/team/kit/tree/feature/x/skills/notes') as Extract<SourcePreview, { token: string }>;
    assert.deepEqual([look.ref, look.folder, look.names.map(name => name.name)], ['feature/x', 'skills/notes', ['notes']]);

    const lab = await repository(hosts, 'https://gitlab.example.com/team/tools/skills');
    await lab.commit({ 'review/SKILL.md': skillMd('review') });
    const there = await previewSource(box.context, 'https://gitlab.example.com/team/tools/skills/-/tree/main/review') as Extract<SourcePreview, { token: string }>;
    assert.deepEqual([there.repository, there.ref, there.folder, there.names.map(name => name.name)], ['https://gitlab.example.com/team/tools/skills.git', 'main', 'review', ['review']]);
    assert.equal((await previewSource(box.context, 'https://github.com/team/kit/tree/nope/skills')).refused, 'The repository has no branch or tag named nope, or by any longer name this link starts with.');
  } finally { await box.cleanup(); }
});

test('A SKILL.md that stops parsing at a later check is unseen, not gone: nothing turns Off, and its row says why', async () => {
  const box = await sandbox();
  try {
    const repo = await repository(hosts, 'https://github.com/team/kit');
    await repo.commit({ 'notes/SKILL.md': skillMd('notes'), 'other/SKILL.md': skillMd('other'), 'third/SKILL.md': skillMd('third') });
    await add(box, 'https://github.com/team/kit');
    const id = await sourceId(box);
    await applySkills(box.context, box.tools, [{ key: 'notes', managed: true, off: [], seenManaged: false }]);
    await repo.commit({ 'notes/SKILL.md': '---\nname: [notes\n---\nBroken.\n', 'other/SKILL.md': null });
    assert.deepEqual((await check(box, id)).sourced, []);
    assert.deepEqual([(await itemOf(box, 'notes'))!.on, (await itemOf(box, 'other'))!.source], [true, id], 'not read whole: nothing is gone this time');
    const row = (await sourcesView(box.context)).sources[0];
    assert.deepEqual(row.names.map(name => [name.key, name.state, name.why]), [['notes', 'unusable', 'its SKILL.md can’t be read as a skill (Malformed YAML frontmatter)'], ['third', 'in', undefined], ['other', 'in', undefined]]);
    // Every skill there unusable: the source can't be read at all, and still nothing turns Off.
    await repo.commit({ 'third/SKILL.md': null });
    assert.equal((await check(box, id)).stopped, 'Couldn’t read github.com/team/kit. No skill there can be used: each one says why.');
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
    await applySkills(box.context, box.tools, [{ key: 'notes', managed: true, off: [], seenManaged: false }]);
    await repo.commit({ 'skills/notes': null, 'moved/notes/SKILL.md': skillMd('notes') });
    const done = await check(box, id), why = 'The repository has no folder skills/notes on main: moved or deleted there. Nothing changes until it is back.';
    assert.equal(done.stopped, `Couldn’t read github.com/team/kit (main/skills/notes). ${why}`);
    assert.deepEqual([(await itemOf(box, 'notes'))!.on, (await itemOf(box, 'notes'))!.source], [true, id]);
    assert.equal((await sourcesView(box.context)).sources[0].problem, why, 'its row says why');
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
    assert.equal((await previewSource(box.context, 'https://github.com/me/config/tree/main/skills/notes')).refused, 'That is the Git repo Pull and Push use here, so it can’t be a source too. A source is only ever read; that repo stays on the Git repo page.');
    await rm(join(box.home, '.central-knot/repo.json'));
    await add(box, 'me/config');
    assert.equal((await previewSource(box.context, 'https://github.com/me/config.git')).refused, 'That link is a source already: its row is below.');
  } finally { await box.cleanup(); }
});

// ---------- The fetch ----------

test('The fetch fails: no repository there, or its branch deleted later: the look is refused, a check changes nothing and its row says why', async () => {
  const box = await sandbox();
  try {
    assert.match((await previewSource(box.context, 'https://github.com/nobody/nothing')).refused ?? '', /No access, or no repository there|Can’t reach the source/);
    const repo = await repository(hosts, 'https://github.com/team/kit');
    await repo.commit({ 'notes/SKILL.md': skillMd('notes') });
    repo.branch('topic');
    await add(box, 'https://github.com/team/kit/tree/topic');
    const id = await sourceId(box);
    repo.branch('main', false);
    repo.git('branch', '-D', 'topic');
    const done = await check(box, id);
    assert.equal(done.stopped, 'Couldn’t read github.com/team/kit (topic). The source has no branch or tag by that name now.');
    assert.deepEqual([(await itemOf(box, 'notes'))!.source, (await sourcesView(box.context)).sources[0].problem], [id, 'The source has no branch or tag by that name now.']);
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
    assert.deepEqual([first.sourced, second.sourced].sort((one, two) => two!.length - one!.length), [[{ name: 'notes', answer: 'update' }], []]);
    assert.equal((await readHistory(box.context)).filter(event => event.cause === 'source' && event.kind === 'edit').length, 1);

    await repo.commit({ 'SKILL.md': skillMd('notes', 'Third.') });
    let release!: () => void;
    queue = new Promise<void>(done => { release = done; });
    const checking = checkSource(box.context, now(box), id, turn);
    await new Promise(done => setTimeout(done, 300));
    const removed = turn(() => removeSource(box.context, id));
    release();
    assert.equal((await checking).stopped, undefined, 'the check took its turn first');
    await removed;
    assert.deepEqual([(await sourcesView(box.context)).sources, await bodyOf(box, 'notes')], [[], 'Third.']);

    const { id: again } = await oneSkill(box, 'other');
    queue = new Promise<void>(done => { release = done; });
    const removing = turn(() => removeSource(box.context, again));
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
    await removeSource(box.context, id);
    assert.deepEqual([await itemOf(box, 'notes'), await everywhere(box)], before, 'nothing about the item is written');
    assert.deepEqual((await sourcesView(box.context)).sources, []);
    // Linked to a source that is no longer recorded: a new source with the same name and content links it again.
    const { added } = await add(box, 'https://github.com/team/notes');
    assert.deepEqual(added.sourced, [{ name: 'notes', answer: 'link' }]);
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
    const look = await previewSource(first, 'team/notes') as Extract<SourcePreview, { token: string }>;
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
    assert.deepEqual([item.on, item.versions.length, (await seen(box)).fact?.takeInAnswers], [false, 1, undefined], 'not found: the item is Off, its copy in Claude Code a found copy left alone');
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
    await applySkills(box.context, managed, [{ key: 'notes', managed: true, off: [], seenManaged: false }]);
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
    await applySkills(box.context, box.tools, [{ key: 'notes', managed: true, off: [], seenManaged: false }]);
    assert.deepEqual([(await sourcesView(box.context)).sources, (await itemOf(box, 'notes'))!.source, (await seen(box)).fact?.fromSource], [[], undefined, undefined]);
    assert.equal(await readFile(join(box.home, '.central-knot/sources.json'), 'utf8').catch(() => 'none'), 'none', 'and nothing is written for sources');
  } finally { await box.cleanup(); }
});
