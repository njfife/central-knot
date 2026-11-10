import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, realpath, rename, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { discover } from '../src/discovery.ts';
import { whyPushFailed } from '../src/plugins.ts';
import { classify, connectRepo, disconnectRepo, pullRepo, pushRepo, repoView, sourceTool, undoPulledBase, undoSettingsChange, type BaseInstructions, type SideItem } from '../src/gitrepo.ts';
import { applyChanges, manageView, readHistory, restoreFromHistory } from '../src/manage.ts';
import { applyMcp, mcpView, restoreMcp } from '../src/mcp.ts';
import { agentsView, applyAgents, restoreAgent } from '../src/agents.ts';
import { applyBase, baseView, instructionsView, repoBase } from '../src/instructions.ts';
import type { ShareContext } from '../src/share.ts';
import type { HarnessId, RepoView } from '../src/types.ts';

const tools: HarnessId[] = ['claude-cli', 'copilot-cli'];
const skillText = (name: string, body = 'Body.') => `---\nname: ${name}\ndescription: The ${name} skill.\n---\n\n${body}\n`;
const git = (cwd: string, ...args: string[]) => execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8' }).trim();

async function world() {
  const base = await realpath(await mkdtemp(join(tmpdir(), 'ck-repo-')));
  const remote = join(base, 'config.git');
  execFileSync('git', ['init', '--quiet', '--bare', '--initial-branch=main', remote]);
  const home = async (name: string, present: HarnessId[] = tools) => {
    const path = join(base, name);
    const folders: Partial<Record<HarnessId, string>> = { 'claude-cli': '.claude/skills', 'copilot-cli': '.copilot/skills', 'codex-cli': '.codex/skills' };
    for (const tool of present) await mkdir(join(path, folders[tool]!), { recursive: true });
    const context: ShareContext = { home: path, mode: 'custom', build: 'test', settingsPath: join(base, `${name}.json`), realHome: join(base, 'real'),
      read: () => Promise.all(present.map(harness => discover({ home: path, mode: 'custom', harness }))) };
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
    const addedBy = (key: string) => readHistory(second).then(events => events.find(event => event.key === key && event.kind === 'added')!);
    const review = await addedBy('review');
    assert.deepEqual([review.via, review.losers.map(loser => loser.tool).sort()], ['repo', tools]);
    assert.equal((await restoreFromHistory(second, review.id)).stopped, undefined);
    assert.equal((await restoreMcp(second, tools, (await addedBy('mcp:docs')).id)).stopped, undefined);
    assert.equal((await restoreAgent(second, tools, (await addedBy('agent:planner')).id)).stopped, undefined);
    assert.deepEqual([(await manageView(second)).skills, (await mcpView(second, tools)).servers, (await agentsView(second, tools)).servers].map(list => list.length), [0, 0, 0]);
  } finally { await box.cleanup(); }
});

/** Two computers on one repo: the first pushed a Managed MCP server and agent, and the second pulled them. */
async function serverAndAgentOnTwo(box: Awaited<ReturnType<typeof world>>) {
  const first = await box.home('first');
  await seedServerAndAgent(first);
  await connectRepo(first, box.remote, '');
  await pushRepo(first);
  const second = await box.home('second');
  await connectRepo(second, box.remote, '');
  await pullRepo(second);
  return { first, second, firstPlanner: join(first.home, '.claude/agents/planner.md'), secondPlanner: join(second.home, '.claude/agents/planner.md') };
}
const edit = async (path: string, from: string, to: string) => writeFile(path, (await readFile(path, 'utf8')).replace(from, to));

test('An MCP server’s edit and an agent setting only Claude Code has arrive through Pull; that setting’s Pull has its own Undo and Redo', async () => {
  const box = await world();
  try {
    const { first, second, firstPlanner, secondPlanner } = await serverAndAgentOnTwo(box);
    await writeFile(join(first.home, '.copilot/mcp-config.json'), JSON.stringify({ mcpServers: { docs: { type: 'local', command: 'docs-server', args: ['--port', '8'], env: { TOKEN: 'abc' }, tools: ['*'] } } }));
    await applyMcp(first, tools, [], { settleMs: 0 });
    await edit(firstPlanner, 'model: opus', 'model: sonnet');
    assert.deepEqual(rows(live(await repoView(first)).outgoing), ['docs:changed', 'planner:changed']);
    await pushRepo(first);
    await pullRepo(second);
    assert.deepEqual(JSON.parse(await readFile(join(second.home, '.copilot/mcp-config.json'), 'utf8')).mcpServers.docs.args, ['--port', '8']);
    assert.match(await readFile(secondPlanner, 'utf8'), /model: sonnet/);
    const settings = (await readHistory(second)).filter(event => event.key === 'agent:planner' && event.via === 'repo').at(-1)!;
    await applyAgents(second, tools, []);
    assert.equal((await undoSettingsChange(second, settings.id)).stopped, undefined, 'Undo still works after a sync pass');
    assert.match(await readFile(secondPlanner, 'utf8'), /model: opus/, 'Undo of a settings-only pull puts the earlier file back');
    const redo = (await readHistory(second)).find(event => event.undoneBy === undefined && event.kind === 'restored' && event.key === 'agent:planner')!;
    assert.equal((await undoSettingsChange(second, redo.id)).stopped, undefined, 'and Redo puts the pulled one back');
    assert.match(await readFile(secondPlanner, 'utf8'), /model: sonnet/);
    // An edit made since is never undone away.
    const redone = (await readHistory(second)).find(event => event.undoneBy === undefined && event.kind === 'restored' && event.key === 'agent:planner')!;
    await writeFile(secondPlanner, `${await readFile(secondPlanner, 'utf8')}Also check the tests.\n`);
    assert.match((await undoSettingsChange(second, redone.id)).stopped ?? '', /edited since/);
  } finally { await box.cleanup(); }
});

test('A repo change to an agent this computer can’t read just now waits, and comes in once its copy reads again', async () => {
  const box = await world();
  try {
    const { first, second, firstPlanner, secondPlanner } = await serverAndAgentOnTwo(box);
    const secondCopilot = join(second.home, '.copilot/agents/planner.agent.md');
    const readable = await readFile(secondCopilot, 'utf8');
    await writeFile(secondCopilot, 'half saved');
    await edit(firstPlanner, 'Plan carefully.', 'Plan in small steps.');
    await applyAgents(first, tools, []);
    await pushRepo(first);
    assert.equal((await pullRepo(second)).pulled, 0, 'a change left waiting is not counted as pulled');
    assert.deepEqual(live(await repoView(second)).incoming.map(row => [row.name, !!row.held]), [['planner', true]]);
    await writeFile(secondCopilot, readable);
    await pullRepo(second);
    assert.match(await readFile(secondPlanner, 'utf8'), /Plan in small steps/);
  } finally { await box.cleanup(); }
});

test('Deletions of an MCP server and an agent wait while Automatic sync is off, come in once it is on, and Restore brings Claude Code’s own file back', async () => {
  const box = await world();
  try {
    const { first, second, secondPlanner } = await serverAndAgentOnTwo(box);
    await edit(join(first.home, '.claude/agents/planner.md'), 'model: opus', 'model: sonnet');
    await pushRepo(first);
    await pullRepo(second);
    // Removed from both tools that have it (Claude Code's settings got it through Write now, or by hand).
    await writeFile(join(first.home, '.copilot/mcp-config.json'), JSON.stringify({ mcpServers: {} }));
    const claudeSettings = join(first.home, '.claude.json');
    const settings = JSON.parse(await readFile(claudeSettings, 'utf8').catch(() => '{}'));
    delete settings.mcpServers?.docs;
    await writeFile(claudeSettings, JSON.stringify(settings));
    await rm(join(first.home, '.claude/agents/planner.md'));
    // A server's last copy gone counts as deleted once it has stayed gone a while (it may only be unreadable for a moment).
    await applyMcp(first, tools, [], { settleMs: 0, now: Date.now() + 86_400_000 });
    await applyAgents(first, tools, [], { settleMs: 0 });
    assert.deepEqual(rows(live(await repoView(first)).outgoing), ['docs:removed', 'planner:removed']);
    await pushRepo(first);

    const syncState = async (syncOn: boolean) => live(await repoView(second, { check: true, syncOn })).incoming.map(row => [row.name, row.sync, !!row.retry]);
    assert.deepEqual(await syncState(false), [['planner', 'waits', false], ['docs', 'waits', false]], 'said before Pull, not discovered by it');
    const waited = await pullRepo(second, { syncOn: false });
    assert.equal(waited.pulled, 0);
    assert.equal(Object.keys((await agentsView(second, tools)).servers[0].copies).length, 2, 'no copy removed while the deletion waits');
    assert.ok((await mcpView(second, tools)).servers.some(server => server.key === 'docs'));
    assert.deepEqual(await syncState(false), [['planner', 'waits', true], ['docs', 'waits', true]]);
    assert.deepEqual(await syncState(true), [['planner', 'ready', true], ['docs', 'ready', true]]);
    const view = live((await pullRepo(second, { syncOn: true })).view);
    assert.deepEqual([view.incoming, view.outgoing], [[], []]);
    assert.deepEqual([(await mcpView(second, tools)).servers.length, (await agentsView(second, tools)).servers.length], [0, 0]);
    const deleted = (await readHistory(second)).filter(event => event.key === 'agent:planner' && event.kind === 'deleted').at(-1)!;
    assert.equal((await restoreAgent(second, tools, deleted.id)).stopped, undefined);
    assert.match(await readFile(secondPlanner, 'utf8'), /model: sonnet/);
  } finally { await box.cleanup(); }
});

test('Where only Claude Code takes MCP servers, the repo’s server waits, said before Pull, and Push never removes it from the repo', async () => {
  const box = await world();
  try {
    const first = await box.home('first');
    await seedServerAndAgent(first);
    await connectRepo(first, box.remote, '');
    await pushRepo(first);
    const claudeOnly = await box.home('claude-only', ['claude-cli']);
    const before = live((await connectRepo(claudeOnly, box.remote, '')).view);
    assert.deepEqual(before.incoming.filter(row => row.kind === 'mcp').map(row => [row.name, row.pull]), [['docs', 'stuck']]);
    const after = live((await pullRepo(claudeOnly)).view);
    assert.deepEqual([after.incoming.filter(row => row.kind === 'mcp').map(row => [row.name, row.pull]), rows(after.outgoing)], [[['docs', 'stuck']], []], 'not read as removed here');
    await pushRepo(claudeOnly);
    assert.match(git(box.remote, 'ls-tree', '-r', '--name-only', 'main'), /mcp\/docs\.json/);
  } finally { await box.cleanup(); }
});

/** A computer with one Managed skill in the repo, and a second clone of the repo to commit to it as someone else would. */
async function oneSkillAndAnAuthor(box: Awaited<ReturnType<typeof world>>, options: { off?: HarnessId[] } = {}) {
  const first = await box.home('first');
  await skill(first, '.claude/skills', 'solo', skillText('solo', 'Before.'));
  await applyChanges(first, [{ key: 'solo', managed: true, off: options.off ?? [] }]);
  await connectRepo(first, box.remote, '');
  await pushRepo(first);
  const author = join(box.base, 'author');
  execFileSync('git', ['clone', '--quiet', box.remote, author]);
  const commit = (message: string) => { git(author, 'add', '-A'); git(author, '-c', 'user.name=a', '-c', 'user.email=a@b', 'commit', '--quiet', '-m', message); git(author, 'push', '--quiet', 'origin', 'HEAD:main'); };
  return { first, author, commit };
}

test('A skill only one tool has: Pull replaces that copy, and Undo in History puts it back; a SKILL.md that stops parsing is held, never a removal', async () => {
  const box = await world();
  try {
    const { first, author, commit } = await oneSkillAndAnAuthor(box, { off: ['copilot-cli'] });
    await writeFile(join(author, 'skills/solo/SKILL.md'), skillText('solo', 'After.'));
    commit('edit');
    await pullRepo(first);
    assert.match(await readFile(join(first.home, '.claude/skills/solo/SKILL.md'), 'utf8'), /After/);
    const pulled = (await readHistory(first)).find(event => event.key === 'solo' && event.via === 'repo')!;
    assert.equal((await restoreFromHistory(first, pulled.id)).stopped, undefined);
    assert.match(await readFile(join(first.home, '.claude/skills/solo/SKILL.md'), 'utf8'), /Before/);
    // A SKILL.md that stops parsing hides the skill from every tool's listing: that is never offered as a removal.
    await writeFile(join(first.home, '.claude/skills/solo/SKILL.md'), '---\nname: solo\ndescription: Has: a colon\n---\n');
    assert.deepEqual(live(await repoView(first)).outgoing.map(row => [row.name, !!row.held]), [['solo', true]]);
  } finally { await box.cleanup(); }
});

test('A commit outside the layout still has to be pulled before a push; the branch deleted in the repo reads as nothing deleted, and Push puts it back', async () => {
  const box = await world();
  try {
    const { first, author, commit } = await oneSkillAndAnAuthor(box);
    await writeFile(join(author, 'README.md'), 'Notes.\n');
    commit('readme');
    let view = live(await repoView(first, { check: true }));
    assert.ok(view.pushBlocked);
    view = live((await pullRepo(first)).view);
    assert.equal(view.pushBlocked, undefined);
    // The repo out of reach: the reason is kept to show, and Pull and Push refuse rather than act on what was last seen.
    await rename(box.remote, `${box.remote}.away`);
    assert.match(live(await repoView(first, { check: true })).problem ?? '', /No access/);
    assert.match((await pullRepo(first)).stopped ?? '', /No access/);
    assert.match((await pushRepo(first)).stopped ?? '', /No access/);
    await rename(`${box.remote}.away`, box.remote);
    git(box.remote, 'update-ref', '-d', 'refs/heads/main');
    view = live(await repoView(first, { check: true }));
    assert.deepEqual([view.branchGone, view.incoming, view.outgoing], [true, [], []]);
    assert.equal((await pushRepo(first)).stopped, undefined);
    assert.ok(git(box.remote, 'rev-parse', 'main'));
  } finally { await box.cleanup(); }
});

test('Pull counts and says only its own items: another Managed skill held for its own reason doesn’t make a pulled one look stuck', async () => {
  const box = await world();
  try {
    const { first, author, commit } = await oneSkillAndAnAuthor(box);
    await skill(first, '.claude/skills', 'linked');
    await applyChanges(first, [{ key: 'linked', managed: true, off: [] }]);
    await symlink('SKILL.md', join(first.home, '.claude/skills/linked/alias.md'));
    await mkdir(join(author, 'skills/fresh'), { recursive: true });
    await writeFile(join(author, 'skills/fresh/SKILL.md'), skillText('fresh'));
    commit('fresh');
    const pulled = await pullRepo(first);
    assert.equal(pulled.pulled, 1);
    assert.ok(!pulled.results.some(result => result.item === 'linked'), 'the held bystander is not in Pull’s results');
  } finally { await box.cleanup(); }
});

test('A skill of the repo’s name that this computer never Managed: the row says so, and Undo of the Pull brings that skill back', async () => {
  const box = await world();
  try {
    const first = await box.home('first');
    await skill(first, '.claude/skills', 'review', skillText('review', 'Shared.'));
    await applyChanges(first, [{ key: 'review', managed: true, off: [] }]);
    await connectRepo(first, box.remote, '');
    await pushRepo(first);
    const second = await box.home('second');
    await skill(second, '.claude/skills', 'review', skillText('review', 'Mine.'));
    const view = live((await connectRepo(second, box.remote, '')).view);
    assert.deepEqual(view.incoming.map(row => [row.name, row.change, row.alsoHere]), [['review', 'added', 'unmanaged']]);
    await pullRepo(second);
    for (const root of ['.claude/skills', '.copilot/skills']) assert.match(await readFile(join(second.home, root, 'review/SKILL.md'), 'utf8'), /Shared/);
    const replaced = (await readHistory(second)).find(event => event.key === 'review' && event.kind === 'edit' && event.via === 'repo')!;
    assert.equal((await restoreFromHistory(second, replaced.id)).stopped, undefined, 'the replaced copy is still in the store');
    assert.match(await readFile(join(second.home, '.claude/skills/review/SKILL.md'), 'utf8'), /Mine/);
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
