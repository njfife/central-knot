import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { discover } from '../src/discovery.ts';
import { whyPushFailed } from '../src/plugins.ts';
import { classify, connectRepo, disconnectRepo, pullRepo, pushRepo, repoView, undoSettingsChange, type BaseInstructions, type SideItem } from '../src/gitrepo.ts';
import { applyChanges, manageView, readHistory, restoreFromHistory } from '../src/manage.ts';
import { applyMcp, mcpView, restoreMcp } from '../src/mcp.ts';
import { agentsView, applyAgents, restoreAgent } from '../src/agents.ts';
import type { ShareContext } from '../src/share.ts';
import type { HarnessId, RepoView } from '../src/types.ts';

const tools: HarnessId[] = ['claude-cli', 'copilot-cli'];
const skillText = (name: string, body = 'Body.') => `---\nname: ${name}\ndescription: The ${name} skill.\n---\n\n${body}\n`;
const git = (cwd: string, ...args: string[]) => execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8' }).trim();

async function world() {
  const base = await realpath(await mkdtemp(join(tmpdir(), 'ck-repo-')));
  const remote = join(base, 'config.git');
  execFileSync('git', ['init', '--quiet', '--bare', '--initial-branch=main', remote]);
  const home = async (name: string) => {
    const path = join(base, name);
    for (const folder of ['.claude/skills', '.copilot/skills']) await mkdir(join(path, folder), { recursive: true });
    const context: ShareContext = { home: path, mode: 'custom', build: 'test', settingsPath: join(base, `${name}.json`), realHome: join(base, 'real'),
      read: () => Promise.all(tools.map(harness => discover({ home: path, mode: 'custom', harness }))) };
    return context;
  };
  return { base, remote, home, cleanup: () => rm(base, { recursive: true, force: true }) };
}

async function skill(context: ShareContext, root: string, folder: string, text = skillText(folder)) {
  await mkdir(join(context.home, root, folder), { recursive: true });
  await writeFile(join(context.home, root, folder, 'SKILL.md'), text);
}
const live = (view: RepoView) => { assert.ok(view.connected); return view; };
const rows = (list: { name: string; change: string }[]) => list.map(row => `${row.name}:${row.change}`).sort();

/** A home with a managed MCP server and agent, synced between Claude Code and Copilot CLI. */
async function seedServerAndAgent(context: ShareContext) {
  await writeFile(join(context.home, '.copilot/mcp-config.json'), JSON.stringify({ mcpServers: { docs: { type: 'local', command: 'docs-server', args: ['--port', '7'], env: { TOKEN: 'abc' }, tools: ['*'] } } }));
  await mkdir(join(context.home, '.claude/agents'), { recursive: true });
  await writeFile(join(context.home, '.claude/agents/planner.md'), '---\nname: planner\ndescription: Plans work.\nmodel: opus\n---\n\nPlan carefully.\n');
  assert.ok(!(await applyMcp(context, tools, [{ key: 'docs', managed: true, off: [] }])).stopped);
  assert.ok(!(await applyAgents(context, tools, [{ key: 'planner', managed: true, off: [] }])).stopped);
}

test('Push puts the Managed set in the repo’s layout; another computer pulls it into its tools, Managed, and is then up to date', async () => {
  const box = await world();
  try {
    const first = await box.home('first');
    await skill(first, '.claude/skills', 'review');
    await writeFile(join(first.home, '.claude/skills/review/notes.log'), 'kept as-is\n');
    assert.ok(!(await applyChanges(first, [{ key: 'review', managed: true, off: [] }])).stopped);
    await seedServerAndAgent(first);
    let view = live((await connectRepo(first, box.remote, '')).view);
    assert.equal(view.branch, 'main');
    assert.deepEqual(rows(view.outgoing), ['docs:added', 'planner:added', 'review:added']);
    assert.equal(view.pushBlocked, undefined, 'an empty repo can take a push at once');
    const pushed = await pushRepo(first);
    assert.equal(pushed.stopped, undefined);
    view = live(pushed.view);
    assert.deepEqual([view.incoming, view.outgoing], [[], []]);
    // The layout, as anyone browsing the repo sees it.
    assert.deepEqual(git(box.remote, 'ls-tree', '-r', '--name-only', 'main').split('\n'), ['agents/planner.md', 'mcp/docs.json', 'skills/review/SKILL.md', 'skills/review/notes.log']);
    assert.deepEqual(JSON.parse(git(box.remote, 'show', 'main:mcp/docs.json')), { type: 'stdio', command: 'docs-server', args: ['--port', '7'], env: { TOKEN: 'abc' } });
    assert.match(git(box.remote, 'show', 'main:agents/planner.md'), /model: opus/, 'Claude Code’s own agent file goes as written');
    // A Managed agent one tool can't read just now is never offered as removed (Push would delete it from the repo).
    const copilotPlanner = join(first.home, '.copilot/agents/planner.agent.md');
    const kept = await readFile(copilotPlanner, 'utf8');
    await writeFile(copilotPlanner, 'half saved');
    assert.deepEqual(live(await repoView(first)).outgoing.map(row => [row.name, !!row.held]), [['planner', true]]);
    await writeFile(copilotPlanner, kept);

    const second = await box.home('second');
    view = live((await connectRepo(second, box.remote, '')).view);
    assert.deepEqual(rows(view.incoming), ['docs:added', 'planner:added', 'review:added']);
    assert.equal((await manageView(second)).skills.length, 0, 'connecting writes nothing to the tools');
    // With Sync off, Pull still does what it shows (each item's pass runs for that item alone).
    const pulled = await pullRepo(second, { syncOn: false });
    assert.equal(pulled.stopped, undefined);
    assert.equal(pulled.pulled, 3);
    for (const root of ['.claude/skills', '.copilot/skills']) assert.equal(await readFile(join(second.home, root, 'review/notes.log'), 'utf8'), 'kept as-is\n');
    assert.ok((await manageView(second)).skills.find(item => item.key === 'review')!.managed);
    const docs = (await mcpView(second, tools)).servers.find(server => server.key === 'docs')!;
    assert.ok(docs.managed && docs.copies['copilot-cli']);
    assert.ok((await agentsView(second, tools)).servers.find(agent => agent.key === 'planner')!.managed);
    assert.match(await readFile(join(second.home, '.claude/agents/planner.md'), 'utf8'), /model: opus/);
    view = live(pulled.view);
    assert.deepEqual([view.incoming, view.outgoing, view.base?.id], [[], [], view.latest?.id]);
    // Undo add after a Pull takes back every copy Pull made, whatever the kind.
    const addedBy = (key: string) => readHistory(second.home).then(events => events.find(event => event.key === key && event.kind === 'added')!);
    const review = await addedBy('review');
    assert.deepEqual([review.via, review.losers.map(loser => loser.tool).sort()], ['repo', tools]);
    assert.equal((await restoreFromHistory(second, review.id)).stopped, undefined);
    assert.equal((await restoreMcp(second, tools, (await addedBy('mcp:docs')).id)).stopped, undefined);
    assert.equal((await restoreAgent(second, tools, (await addedBy('agent:planner')).id)).stopped, undefined);
    assert.deepEqual([(await manageView(second)).skills, (await mcpView(second, tools)).servers, (await agentsView(second, tools)).servers].map(list => list.length), [0, 0, 0]);
  } finally { await box.cleanup(); }
});

test('An MCP server edited and an agent deleted on one computer arrive on the other through Pull', async () => {
  const box = await world();
  try {
    const first = await box.home('first');
    await seedServerAndAgent(first);
    await connectRepo(first, box.remote, '');
    await pushRepo(first);
    const second = await box.home('second');
    await connectRepo(second, box.remote, '');
    await pullRepo(second);

    // A setting only Claude Code has (the agent's model) travels too.
    const firstPlanner = join(first.home, '.claude/agents/planner.md');
    await writeFile(firstPlanner, (await readFile(firstPlanner, 'utf8')).replace('model: opus', 'model: sonnet'));
    assert.deepEqual(rows(live(await repoView(first)).outgoing), ['planner:changed']);
    await pushRepo(first);
    await pullRepo(second);
    assert.match(await readFile(join(second.home, '.claude/agents/planner.md'), 'utf8'), /model: sonnet/);
    const settings = (await readHistory(second.home)).filter(event => event.key === 'agent:planner' && event.via === 'repo').at(-1)!;
    await applyAgents(second, tools, []);
    assert.equal((await undoSettingsChange(second, settings.id)).stopped, undefined, 'Undo still works after a sync pass');
    assert.match(await readFile(join(second.home, '.claude/agents/planner.md'), 'utf8'), /model: opus/, 'Undo of a settings-only pull puts the earlier file back');
    const redo = (await readHistory(second.home)).find(event => event.undoneBy === undefined && event.kind === 'restored' && event.key === 'agent:planner')!;
    assert.equal((await undoSettingsChange(second, redo.id)).stopped, undefined, 'and Redo puts the pulled one back');
    assert.match(await readFile(join(second.home, '.claude/agents/planner.md'), 'utf8'), /model: sonnet/);
    // An edit made since is never undone away.
    const redone = (await readHistory(second.home)).find(event => event.undoneBy === undefined && event.kind === 'restored' && event.key === 'agent:planner')!;
    const plannerHere = join(second.home, '.claude/agents/planner.md');
    await writeFile(plannerHere, `${await readFile(plannerHere, 'utf8')}Also check the tests.\n`);
    assert.match((await undoSettingsChange(second, redone.id)).stopped ?? '', /edited since/);
    await writeFile(plannerHere, (await readFile(plannerHere, 'utf8')).replace('Also check the tests.\n', ''));

    // The repo changes an agent this computer can't read just now: Pull leaves it for later rather than losing it, and once the copy
    // reads again, the repo's version comes in (never overwritten by the next Push).
    const secondCopilot = join(second.home, '.copilot/agents/planner.agent.md');
    const readable = await readFile(secondCopilot, 'utf8');
    await writeFile(secondCopilot, 'half saved');
    await writeFile(firstPlanner, (await readFile(firstPlanner, 'utf8')).replace('Plan carefully.', 'Plan in small steps.'));
    await applyAgents(first, tools, []);
    await pushRepo(first);
    assert.equal((await pullRepo(second)).pulled, 0, 'a change left waiting is not counted as pulled');
    assert.deepEqual(live(await repoView(second)).incoming.map(row => [row.name, !!row.held]), [['planner', true]]);
    await writeFile(secondCopilot, readable);
    await pullRepo(second);
    assert.match(await readFile(join(second.home, '.claude/agents/planner.md'), 'utf8'), /Plan in small steps/);

    await writeFile(join(first.home, '.copilot/mcp-config.json'), JSON.stringify({ mcpServers: { docs: { type: 'local', command: 'docs-server', args: ['--port', '8'], env: { TOKEN: 'abc' }, tools: ['*'] } } }));
    await rm(join(first.home, '.claude/agents/planner.md'));
    await applyMcp({ ...first, settleMs: 0 }, tools, []);
    await applyAgents(first, tools, [], { settleMs: 0 });
    assert.deepEqual(rows(live(await repoView(first)).outgoing), ['docs:changed', 'planner:removed']);
    await pushRepo(first);

    const view = live((await pullRepo(second)).view);
    assert.deepEqual([view.incoming, view.outgoing], [[], []]);
    assert.deepEqual(JSON.parse(await readFile(join(second.home, '.copilot/mcp-config.json'), 'utf8')).mcpServers.docs.args, ['--port', '8']);
    assert.equal((await agentsView(second, tools)).servers.length, 0);
  } finally { await box.cleanup(); }
});

test('A skill only one tool has: Pull replaces that copy, and Undo in History puts it back', async () => {
  const box = await world();
  try {
    const first = await box.home('first');
    await skill(first, '.claude/skills', 'solo', skillText('solo', 'Before.'));
    await applyChanges(first, [{ key: 'solo', managed: true, off: ['copilot-cli'] }]);
    await connectRepo(first, box.remote, '');
    await pushRepo(first);
    const author = join(box.base, 'author');
    execFileSync('git', ['clone', '--quiet', box.remote, author]);
    await writeFile(join(author, 'skills/solo/SKILL.md'), skillText('solo', 'After.'));
    git(author, '-c', 'user.name=a', '-c', 'user.email=a@b', 'commit', '--quiet', '-am', 'edit'); git(author, 'push', '--quiet', 'origin', 'HEAD:main');
    await pullRepo(first);
    assert.match(await readFile(join(first.home, '.claude/skills/solo/SKILL.md'), 'utf8'), /After/);
    const pulled = (await readHistory(first.home)).find(event => event.key === 'solo' && event.via === 'repo')!;
    assert.equal((await restoreFromHistory(first, pulled.id)).stopped, undefined);
    assert.match(await readFile(join(first.home, '.claude/skills/solo/SKILL.md'), 'utf8'), /Before/);
    // A SKILL.md that stops parsing hides the skill from every tool's listing: that is never offered as a removal.
    await writeFile(join(first.home, '.claude/skills/solo/SKILL.md'), '---\nname: solo\ndescription: Has: a colon\n---\n');
    assert.deepEqual(live(await repoView(first)).outgoing.map(row => [row.name, !!row.held]), [['solo', true]]);
    await writeFile(join(first.home, '.claude/skills/solo/SKILL.md'), skillText('solo', 'Before.'));
    // A commit that touches nothing in the layout still has to be pulled before a push; Pull then just moves to it.
    await writeFile(join(author, 'README.md'), 'Notes.\n');
    git(author, 'add', '-A'); git(author, '-c', 'user.name=a', '-c', 'user.email=a@b', 'commit', '--quiet', '-m', 'readme'); git(author, 'push', '--quiet', 'origin', 'HEAD:main');
    let view = live(await repoView(first, { check: true }));
    assert.ok(view.pushBlocked);
    view = live((await pullRepo(first)).view);
    assert.equal(view.pushBlocked, undefined);
    // The branch deleted in the repo, with nothing else to send: nothing reads as deleted, and Push puts the branch back.
    await pushRepo(first);
    git(box.remote, 'update-ref', '-d', 'refs/heads/main');
    view = live(await repoView(first, { check: true }));
    assert.deepEqual([view.branchGone, view.incoming, view.outgoing], [true, [], []]);
    assert.equal((await pushRepo(first)).stopped, undefined);
    assert.ok(git(box.remote, 'rev-parse', 'main'));
  } finally { await box.cleanup(); }
});

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
    const pulls = (await readHistory(first.home)).filter(event => event.via === 'repo' && event.key === 'review' && Date.parse(event.at) > Date.now() - 60_000);
    assert.equal(pulls.length, 1, 'one pull, one History row');
    const pulled = pulls[0];
    assert.equal((await restoreFromHistory(first, pulled.id)).stopped, undefined);
    for (const root of ['.claude/skills', '.copilot/skills']) assert.match(await readFile(join(first.home, root, 'review/SKILL.md'), 'utf8'), /From the first computer/);
    assert.deepEqual(rows(live(await repoView(first)).outgoing), ['review:changed'], 'the undone pull is a change here, ready to push');
    // With Sync off, two tools edited differently: which is the skill isn't settled, so it neither goes out nor counts as removed.
    await writeFile(join(first.home, '.claude/skills/review/SKILL.md'), skillText('review', 'One way.'));
    await writeFile(join(first.home, '.copilot/skills/review/SKILL.md'), skillText('review', 'Another way.'));
    assert.deepEqual(live(await repoView(first)).outgoing.map(row => [row.name, row.held]), [['review', 'Its copies here differ and haven’t synced yet. Turn on Sync or use Sync once, then look again.']]);
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
    const deleted = (await readHistory(first.home)).find(event => event.key === 'gone' && event.kind === 'deleted')!;
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
    git(author, 'add', '-A'); git(author, '-c', 'user.name=a', '-c', 'user.email=a@b', 'commit', '--quiet', '-m', 'start'); git(author, 'push', '--quiet', 'origin', 'HEAD:main');

    const here = await box.home('here');
    await skill(here, '.claude/skills', 'mine');
    await writeFile(join(here.home, '.claude/skills/mine/debug.log'), 'part of the skill\n');
    // A Managed skill of the same name as the repo's held one, with a file the repo's doesn't have: it never leaks into the repo's.
    await skill(here, '.claude/skills', 'linked');
    await writeFile(join(here.home, '.claude/skills/linked/extra.md'), 'only here\n');
    await applyChanges(here, [{ key: 'mine', managed: true, off: [] }, { key: 'linked', managed: true, off: [] }]);
    let view = live((await connectRepo(here, box.remote, 'main')).view);
    assert.deepEqual(view.incoming.map(row => [row.name, !!row.held]), [['notes', false], ['linked', true]]);
    await pullRepo(here);
    assert.equal(await readFile(join(here.home, '.claude/skills/linked/alias.md'), 'utf8').then(() => true, () => false), false, 'a link is never put in a tool');
    view = live((await pushRepo(here)).view);
    assert.deepEqual(git(box.remote, 'ls-tree', '-r', '--name-only', 'main').split('\n'), ['.gitignore', 'README.md', 'mcp/notes.json', 'skills/README.md', 'skills/linked/SKILL.md', 'skills/linked/alias.md', 'skills/mine/SKILL.md', 'skills/mine/debug.log']);
    assert.deepEqual(view.outgoing, []);
    assert.equal(git(box.remote, 'show', 'main:mcp/notes.json'), '{ "command": "notes-server", "note": "ask Sam before changing" }');
  } finally { await box.cleanup(); }
});

test('The base instructions travel as instructions/base.md when this build has them', async () => {
  const box = await world();
  try {
    const store = new Map<string, string | undefined>([['first', 'Be brief.\n'], ['second', undefined]]);
    let refuse = false;
    const baseFor = (name: string): BaseInstructions => ({ read: async () => store.get(name), apply: async text => { if (refuse) return 'Busy.'; store.set(name, text); return undefined; } });
    const first = await box.home('first');
    await connectRepo(first, box.remote, '');
    assert.deepEqual(rows(live(await repoView(first, { base: baseFor('first') })).outgoing), ['Base instructions:added']);
    await pushRepo(first, { base: baseFor('first') });
    assert.equal(git(box.remote, 'show', 'main:instructions/base.md'), 'Be brief.');
    const second = await box.home('second');
    await connectRepo(second, box.remote, '');
    assert.deepEqual(rows(live(await repoView(second)).incoming), [], 'a build without base instructions leaves the file alone');
    refuse = true;
    await pullRepo(second, { base: baseFor('second') });
    assert.deepEqual(live(await repoView(second, { base: baseFor('second') })).incoming.map(row => row.held), ['Busy.'], 'a failed item waits, named, for the next Pull');
    refuse = false;
    await pullRepo(second, { base: baseFor('second') });
    assert.equal(store.get('second'), 'Be brief.\n');
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

test('Removed here but edited in the repo: the edit comes back on Pull', () => {
  const item = (id: string): SideItem => ({ key: 'skill:review', kind: 'skill', name: 'review', id, paths: [] });
  const sides = { base: new Map([['skill:review', item('old')]]), latest: new Map([['skill:review', item('new')]]), here: new Map(), unsent: new Map() };
  assert.deepEqual(classify(sides).incoming.map(row => [row.change, row.alsoHere]), [['changed', 'removed']]);
  // An item the last Pull couldn't finish, edited here since, then deleted in the repo: the edit still beats the deletion.
  const left = { base: new Map([['skill:review', item('new')]]), latest: new Map(), here: new Map([['skill:review', item('edited')]]), unsent: new Map() };
  assert.deepEqual(classify(left, { 'skill:review': { reason: 'busy', here: 'old' } }).outgoing.map(row => [row.change, row.keptHere]), [['added', true]]);
});
