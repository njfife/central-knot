import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { whyPushFailed } from '../src/plugins.ts';
import { classify, connectRepo, disconnectRepo, pullRepo, pushRepo, repoView, sourceTool, undoPulledBase, type BaseInstructions, type SideItem } from '../src/gitrepo.ts';
import { applyChanges, manageView, readHistory, restoreFromHistory } from '../src/manage.ts';
import { applyMcp } from '../src/mcp.ts';
import { applyBase, baseView, instructionsView, repoBase } from '../src/instructions.ts';
import type { ShareContext } from '../src/share.ts';
import { tools, skillText, git, world, skill, live, rows, edit } from './gitrepo-world.ts';

test('Edits cross both ways; when both sides changed, the repo’s edit wins on Pull and Undo in History brings this computer’s back', async () => {
  const box = await world();
  try {
    const first = await box.home('first');
    await skill(first, '.claude/skills', 'review');
    await applyChanges(first, [{ key: 'review', managed: true, off: [] }]);
    await connectRepo(first, box.remote, '');
    await pushRepo(first);
    const second = await box.home('second');
    await connectRepo(second, box.remote, '');
    await pullRepo(second);

    await writeFile(join(second.home, '.claude/skills/review/SKILL.md'), skillText('review', 'From the second computer.'));
    await applyChanges(second, []);
    assert.deepEqual(rows(live(await repoView(second)).outgoing), ['review:changed']);
    assert.equal((await pushRepo(second)).stopped, undefined);

    // Edited here and not synced yet (Sync off): Pull must keep that edit, and Undo must bring it back.
    await writeFile(join(first.home, '.claude/skills/review/SKILL.md'), skillText('review', 'From the first computer.'));
    const view = live(await repoView(first, { check: true }));
    assert.deepEqual(view.incoming.map(row => [row.name, row.change, row.alsoHere]), [['review', 'changed', 'changed']]);
    assert.ok(view.pushBlocked);
    assert.ok((await pushRepo(first)).stopped, 'a push never overwrites a commit this computer hasn’t seen');

    assert.equal((await pullRepo(first, { syncOn: false })).stopped, undefined);
    for (const root of ['.claude/skills', '.copilot/skills']) assert.match(await readFile(join(first.home, root, 'review/SKILL.md'), 'utf8'), /From the second computer/);
    const pulls = (await readHistory(first)).filter(event => event.via === 'repo' && event.key === 'review' && Date.parse(event.at) > Date.now() - 60_000);
    assert.equal(pulls.length, 1, 'one pull, one History row');
    const pulled = pulls[0];
    assert.equal((await restoreFromHistory(first, pulled.id)).stopped, undefined);
    for (const root of ['.claude/skills', '.copilot/skills']) assert.match(await readFile(join(first.home, root, 'review/SKILL.md'), 'utf8'), /From the first computer/);
    assert.deepEqual(rows(live(await repoView(first)).outgoing), ['review:changed'], 'the undone pull is a change here, ready to push');
    // With Sync off, two tools edited differently: which is the skill isn't settled, so it neither goes out nor counts as removed.
    await writeFile(join(first.home, '.claude/skills/review/SKILL.md'), skillText('review', 'One way.'));
    await writeFile(join(first.home, '.copilot/skills/review/SKILL.md'), skillText('review', 'Another way.'));
    assert.deepEqual(live(await repoView(first)).outgoing.map(row => [row.name, row.held]), [['review', 'Its copies here differ and haven’t synced yet. Turn on Automatic sync, or use Sync once on its page, then click Refresh.']]);
  } finally { await box.cleanup(); }
});

test('A deletion in the repo deletes the skill here, with Restore; an edit here beats a deletion there', async () => {
  const box = await world();
  try {
    const first = await box.home('first');
    for (const name of ['gone', 'edited']) await skill(first, '.claude/skills', name);
    await applyChanges(first, ['gone', 'edited'].map(key => ({ key, managed: true, off: [] })));
    await connectRepo(first, box.remote, '');
    await pushRepo(first);
    const second = await box.home('second');
    await connectRepo(second, box.remote, '');
    await pullRepo(second);
    for (const name of ['gone', 'edited']) await rm(join(second.home, '.claude/skills', name), { recursive: true });
    await applyChanges({ ...second, settleMs: 0 }, []);
    assert.deepEqual(rows(live(await repoView(second)).outgoing), ['edited:removed', 'gone:removed']);
    await pushRepo(second);

    await writeFile(join(first.home, '.claude/skills/edited/SKILL.md'), skillText('edited', 'Still wanted.'));
    await applyChanges(first, []);
    const view = live(await repoView(first, { check: true }));
    assert.deepEqual(rows(view.incoming), ['gone:removed']);
    assert.deepEqual(view.outgoing.map(row => [row.name, row.keptHere]), [['edited', true]]);
    await pullRepo(first);
    const skills = (await manageView(first)).skills;
    assert.deepEqual(skills.map(item => item.key), ['edited']);
    const deleted = (await readHistory(first)).find(event => event.key === 'gone' && event.kind === 'deleted')!;
    assert.equal(deleted.via, 'repo');
    assert.equal((await restoreFromHistory(first, deleted.id)).stopped, undefined);
    assert.ok((await manageView(first)).skills.some(item => item.key === 'gone'));
  } finally { await box.cleanup(); }
});

test('Only the layout is Central Knot’s: other files stay, a file the repo ignores still goes as part of a skill, an item that can’t be brought in stays as the repo has it', async () => {
  const box = await world();
  try {
    const author = join(box.base, 'author');
    execFileSync('git', ['clone', '--quiet', box.remote, author]);
    await mkdir(join(author, 'skills/linked'), { recursive: true });
    await writeFile(join(author, 'README.md'), 'My agent setup.\n');
    await writeFile(join(author, '.gitignore'), '*.log\n');
    await writeFile(join(author, 'skills/README.md'), 'One folder per skill.\n');
    await writeFile(join(author, 'skills/linked/SKILL.md'), skillText('linked'));
    await symlink('SKILL.md', join(author, 'skills/linked/alias.md'));
    // Written by hand, with a key Central Knot doesn't use: Push leaves it byte for byte while it doesn't change here.
    await mkdir(join(author, 'mcp'));
    await writeFile(join(author, 'mcp/notes.json'), '{ "command": "notes-server", "note": "ask Sam before changing" }\n');
    // Finder's file is no part of a skill (no tool's copy keeps one), and a skill vendored as a submodule can't go in a tool.
    await mkdir(join(author, 'skills/tidy'));
    await writeFile(join(author, 'skills/tidy/SKILL.md'), skillText('tidy'));
    await writeFile(join(author, 'skills/tidy/.DS_Store'), 'finder\n');
    git(author, 'add', '-A');
    git(author, 'update-index', '--add', '--cacheinfo', `160000,${'a'.repeat(40)},skills/vendored`); git(author, '-c', 'user.name=a', '-c', 'user.email=a@b', 'commit', '--quiet', '-m', 'start'); git(author, 'push', '--quiet', 'origin', 'HEAD:main');

    const here = await box.home('here');
    await skill(here, '.claude/skills', 'mine');
    await writeFile(join(here.home, '.claude/skills/mine/debug.log'), 'part of the skill\n');
    // A Managed skill of the same name as the repo's held one, with a file the repo's doesn't have: it never leaks into the repo's.
    await skill(here, '.claude/skills', 'linked');
    await writeFile(join(here.home, '.claude/skills/linked/extra.md'), 'only here\n');
    await applyChanges(here, [{ key: 'mine', managed: true, off: [] }, { key: 'linked', managed: true, off: [] }]);
    let view = live((await connectRepo(here, box.remote, 'main')).view);
    assert.deepEqual(view.incoming.map(row => [row.name, !!row.held]), [['notes', false], ['linked', true], ['tidy', false], ['vendored', true]]);
    await pullRepo(here);
    assert.deepEqual(rows(live(await repoView(here)).outgoing), ['mine:added'], 'tidy reads as pulled, not as changed here');
    assert.equal(await readFile(join(here.home, '.claude/skills/linked/alias.md'), 'utf8').then(() => true, () => false), false, 'a link is never put in a tool');
    view = live((await pushRepo(here)).view);
    assert.deepEqual(git(box.remote, 'ls-tree', '-r', '--name-only', 'main').split('\n'), ['.gitignore', 'README.md', 'mcp/notes.json', 'skills/README.md', 'skills/linked/SKILL.md', 'skills/linked/alias.md', 'skills/mine/SKILL.md', 'skills/mine/debug.log', 'skills/tidy/.DS_Store', 'skills/tidy/SKILL.md', 'skills/vendored']);
    assert.deepEqual(view.outgoing, []);
    assert.equal(git(box.remote, 'show', 'main:mcp/notes.json'), '{ "command": "notes-server", "note": "ask Sam before changing" }');
    // Changed here, it goes over the repo's file: the hand-written key stays.
    await writeFile(join(here.home, '.copilot/mcp-config.json'), JSON.stringify({ mcpServers: { notes: { type: 'local', command: 'notes-server', args: ['--v2'], tools: ['*'] } } }));
    await applyMcp(here, tools, [], { settleMs: 0 });
    assert.equal((await pushRepo(here)).stopped, undefined);
    assert.deepEqual(JSON.parse(git(box.remote, 'show', 'main:mcp/notes.json')), { type: 'stdio', command: 'notes-server', args: ['--v2'], note: 'ask Sam before changing' });
  } finally { await box.cleanup(); }
});

test('The base instructions travel as instructions/base.md: Push reads the base here; Pull sets it, and the tools that get it get it', async () => {
  const box = await world();
  try {
    let refuse = false;
    // The real base instructions (~/.central-knot/instructions/base.md), as main.ts hands them over.
    const baseFor = (context: ShareContext): BaseInstructions => { const real = repoBase(context, context.read); return { read: real.read, apply: async text => (refuse ? { stopped: 'Busy.' } : real.apply(text)) }; };
    const setBase = async (context: ShareContext, text: string) => {
      const files = await instructionsView(context, await context.read());
      const seen = Object.fromEntries(files.map(file => [file.tool, { path: file.path, hash: file.hash }]));
      assert.equal((await applyBase(context, await context.read(), { text, expected: (await baseView(context)).hash, tools: ['claude-cli'], seen })).stopped, undefined);
    };
    const first = await box.home('first');
    await setBase(first, 'Be brief.\n');
    await connectRepo(first, box.remote, '');
    assert.deepEqual(rows(live(await repoView(first, { base: baseFor(first) })).outgoing), ['Base instructions:added']);
    await pushRepo(first, { base: baseFor(first) });
    assert.equal(git(box.remote, 'show', 'main:instructions/base.md'), 'Be brief.');
    const second = await box.home('second');
    await setBase(second, 'Be thorough.\n');
    await connectRepo(second, box.remote, '');
    assert.deepEqual(rows(live(await repoView(second)).incoming), [], 'without the base handed over, the file is left alone');
    refuse = true;
    await pullRepo(second, { base: baseFor(second) });
    assert.deepEqual(live(await repoView(second, { base: baseFor(second) })).incoming.map(row => row.held), ['Busy.'], 'a failed item waits, named, for the next Pull');
    refuse = false;
    await pullRepo(second, { base: baseFor(second) });
    assert.equal(await readFile(join(second.home, '.central-knot/instructions/base.md'), 'utf8'), 'Be brief.\n');
    const [claude] = (await instructionsView(second, await second.read())).filter(file => file.tool === 'claude-cli');
    assert.equal(claude.base?.state, 'same', 'Claude Code, which gets the base, holds the pulled text');
    assert.match(claude.text, /Be brief\./);
    assert.ok((await baseView(second)).versions.length >= 1, 'the base it replaced is kept as an earlier version');
    assert.deepEqual(live(await repoView(second, { base: baseFor(second) })).incoming, []);
    // An edit made in the first home comes in the same way.
    await setBase(first, 'Be briefer.\n');
    await pushRepo(first, { base: baseFor(first) });
    await pullRepo(second, { base: baseFor(second) });
    assert.equal(await readFile(join(second.home, '.central-knot/instructions/base.md'), 'utf8'), 'Be briefer.\n');
    const claudeText = async () => (await instructionsView(second, await second.read())).find(file => file.tool === 'claude-cli')!;
    // Each pulled edit is in History with the base's own Undo: only while the base is still as that Pull left it, and only once.
    const [replaced, edit] = (await readHistory(second)).filter(event => event.key === 'instructions:base');
    assert.deepEqual([edit.kind, edit.via, edit.base?.text, replaced.base?.text], ['edit', 'repo', 'Be brief.\n', 'Be thorough.\n']);
    assert.match((await undoPulledBase(second, await second.read(), replaced.id)).stopped ?? '', /changed after that save/, 'the base moved on since the first Pull');
    const undone = await undoPulledBase(second, await second.read(), edit.id);
    assert.deepEqual([undone.stopped, undone.results[0].message], [undefined, 'The base instructions are as they were before that Pull.']);
    assert.deepEqual([await readFile(join(second.home, '.central-knot/instructions/base.md'), 'utf8'), (await claudeText()).base?.state], ['Be brief.\n', 'same']);
    assert.match((await claudeText()).text, /Be brief\./);
    assert.equal((await undoPulledBase(second, await second.read(), edit.id)).stopped, 'That change was already undone.');
    // The earlier text is now a change made here: Push sends it, as any edit of the base.
    assert.deepEqual(rows(live(await repoView(second, { base: baseFor(second) })).outgoing), ['Base instructions:changed']);
    await pushRepo(second, { base: baseFor(second) });
    assert.equal(git(box.remote, 'show', 'main:instructions/base.md'), 'Be brief.');
    await pullRepo(first, { base: baseFor(first) });
    // Deleted there: said before Pull, applied through the base's own apply, and in History with an Undo that puts it all back.
    await setBase(first, '');
    await pushRepo(first, { base: baseFor(first) });
    assert.deepEqual(rows(live(await repoView(second, { base: baseFor(second), check: true })).incoming), ['Base instructions:removed']);
    await pullRepo(second, { base: baseFor(second) });
    assert.deepEqual([(await baseView(second)).text, (await baseView(second)).tools, (await claudeText()).base?.state], ['', [], 'missing']);
    assert.ok((await baseView(second)).versions.some(version => version.firstLine === 'Be brief.'), 'the deleted base is kept as an earlier version');
    const deletion = (await readHistory(second)).find(event => event.key === 'instructions:base' && event.kind === 'deleted')!;
    assert.deepEqual([deletion.kind, deletion.via, deletion.base?.text], ['deleted', 'repo', 'Be brief.\n']);
    assert.equal((await undoPulledBase(second, await second.read(), deletion.id)).results[0]?.message, 'The base instructions are back.');
    assert.deepEqual([(await baseView(second)).text, (await baseView(second)).tools, (await claudeText()).base?.state], ['Be brief.\n', ['claude-cli'], 'same']);
    assert.equal((await undoPulledBase(second, await second.read(), deletion.id)).stopped, 'That change was already undone.');
  } finally { await box.cleanup(); }
});

test('Over HTTP: a read-only repo connects and pulls, and refuses a push in plain words; a bad address or branch changes nothing', async () => {
  const box = await world();
  const server = spawn(process.execPath, [join(import.meta.dirname, '../scripts/git-http-fixture.mjs'), box.base]);
  try {
    const url = await new Promise<string>(resolve => server.stdout.on('data', chunk => resolve(String(chunk).trim().split('\n')[0])));
    const first = await box.home('first');
    await skill(first, '.claude/skills', 'review');
    await applyChanges(first, [{ key: 'review', managed: true, off: [] }]);
    await connectRepo(first, box.remote, '');
    await pushRepo(first);

    const reader = await box.home('reader');
    assert.match((await connectRepo(reader, `${url}/missing.git`, '')).stopped ?? '', /No access/);
    assert.match((await connectRepo(reader, `${url}/config.git`, 'nope')).stopped ?? '', /branch.*nope/);
    assert.equal((await repoView(reader)).connected, false);
    assert.equal((await connectRepo(reader, `${url}/config.git`, 'main')).stopped, undefined);
    await pullRepo(reader);
    await writeFile(join(reader.home, '.claude/skills/review/SKILL.md'), skillText('review', 'Local only.'));
    await applyChanges(reader, []);
    assert.match((await pushRepo(reader)).stopped ?? '', /read|protected/);
    assert.deepEqual(rows(live(await repoView(reader)).outgoing), ['review:changed'], 'a refused push changes nothing here');
    const gone = await disconnectRepo(reader);
    assert.equal(gone.view.connected, false);
    assert.match(await readFile(join(reader.home, '.claude/skills/review/SKILL.md'), 'utf8'), /Local only/, 'disconnecting leaves the tools as they are');
  } finally { server.kill(); await box.cleanup(); }
});

test('A protected branch is said as refused, not as a repo that moved on', () => {
  assert.match(whyPushFailed(1, '! [remote rejected] main -> main (protected branch hook declined)'), /did not accept the push/);
  assert.match(whyPushFailed(1, '! [rejected] main -> main (fetch first)'), /changed just now/);
});

test('classify: an edit in the repo brings back an item removed here; an edit here still beats a deletion after an unfinished Pull; a deletion waits while Automatic sync is off', () => {
  const item = (id: string): SideItem => ({ key: 'skill:review', kind: 'skill', name: 'review', id, paths: [] });
  const sides = { base: new Map([['skill:review', item('old')]]), latest: new Map([['skill:review', item('new')]]), here: new Map(), unsent: new Map() };
  assert.deepEqual(classify(sides).incoming.map(row => [row.change, row.alsoHere]), [['changed', 'removed']]);
  // An item the last Pull couldn't finish, edited here since, then deleted in the repo: the edit still beats the deletion.
  const left = { base: new Map([['skill:review', item('new')]]), latest: new Map(), here: new Map([['skill:review', item('edited')]]), unsent: new Map() };
  assert.deepEqual(classify(left, { 'skill:review': { reason: 'busy', here: 'old' } }).outgoing.map(row => [row.change, row.keptHere]), [['added', true]]);
  // An agent's deletion waits while Automatic sync is off; one the last Pull left for that reason says so once sync is on.
  const agent = (id: string): SideItem => ({ key: 'agent:planner', kind: 'agent', name: 'planner', id, paths: [] });
  const removed = { base: new Map([['agent:planner', agent('a')]]), latest: new Map(), here: new Map([['agent:planner', agent('a')]]), unsent: new Map() };
  assert.equal(classify(removed, {}, false).incoming[0].sync, 'waits');
  assert.equal(classify(removed, {}, true).incoming[0].sync, undefined);
  const leftWaiting = { ...removed, base: new Map() };
  assert.equal(classify(leftWaiting, { 'agent:planner': { reason: 'waits', here: 'a', waitedForSync: true } }, true).incoming[0].sync, 'ready');
  // A repo deletion of an item this computer can't read, kept by the last Pull: still listed as a removal waiting, never lost.
  const unread = { base: new Map(), latest: new Map(), here: new Map(), unsent: new Map([['skill:review', { item: item('x'), reason: 'unreadable' }]]) };
  assert.deepEqual(classify(unread, { 'skill:review': { reason: 'unreadable', heldFor: true } }).incoming.map(row => [row.change, row.pull]), [['removed', 'stuck']]);
});

test('sourceTool: the copy that stands for an item is a full one before a one-way one, never one edited where it is one-way, and none when the edits disagree', () => {
  const copy = (hash: string) => ({ hash }) as never;
  const facts = (more: object) => ({ key: 'planner', name: 'planner', managed: true, off: [], copies: { 'claude-cli': copy('a'), 'copilot-cli': copy('a') }, ...more }) as never;
  assert.deepEqual(sourceTool(facts({})), { tool: 'claude-cli' });
  assert.deepEqual(sourceTool(facts({ limits: { 'claude-cli': 'without tools' } })), { tool: 'copilot-cli' }, 'a full copy first');
  assert.deepEqual(sourceTool(facts({ stopped: ['claude-cli'] })), { tool: 'copilot-cli' }, 'not a one-way copy edited there');
  assert.ok('why' in sourceTool(facts({ stopped: ['claude-cli', 'copilot-cli'] })), 'no copy left to stand for it');
  const disagree = facts({ copies: { 'claude-cli': copy('a'), 'copilot-cli': copy('b') }, edited: ['claude-cli', 'copilot-cli'] });
  const unsettled = sourceTool(disagree);
  assert.ok('why' in unsettled && /haven’t synced/.test(unsettled.why), 'edits waiting to spread that disagree');
});
