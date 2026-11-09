import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { discover } from '../src/discovery.ts';
import { connectRepo, disconnectRepo, pullRepo, pushRepo, repoView, type BaseInstructions } from '../src/gitrepo.ts';
import { applyChanges, manageView, readHistory, restoreFromHistory } from '../src/manage.ts';
import { applyMcp, mcpView } from '../src/mcp.ts';
import { agentsView, applyAgents } from '../src/agents.ts';
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

/** A home with a managed skill, MCP server and agent, all synced between Claude Code and Copilot CLI. */
async function seeded(context: ShareContext) {
  await skill(context, '.claude/skills', 'review');
  await writeFile(join(context.home, '.claude/skills/review/notes.log'), 'kept as-is\n');
  await writeFile(join(context.home, '.copilot/mcp-config.json'), JSON.stringify({ mcpServers: { docs: { type: 'local', command: 'docs-server', args: ['--port', '7'], env: { TOKEN: 'abc' }, tools: ['*'] } } }));
  await mkdir(join(context.home, '.claude/agents'), { recursive: true });
  await writeFile(join(context.home, '.claude/agents/planner.md'), '---\nname: planner\ndescription: Plans work.\nmodel: opus\n---\n\nPlan carefully.\n');
  assert.ok(!(await applyChanges(context, [{ key: 'review', managed: true, off: [] }])).stopped);
  assert.ok(!(await applyMcp(context, tools, [{ key: 'docs', managed: true, off: [] }])).stopped);
  assert.ok(!(await applyAgents(context, tools, [{ key: 'planner', managed: true, off: [] }])).stopped);
}

test('Push puts the Managed set in the repo’s layout; another computer pulls it into its tools, Managed, and is then up to date', async () => {
  const box = await world();
  try {
    const first = await box.home('first');
    await seeded(first);
    let view = live((await connectRepo(first, box.remote, '')).view);
    assert.equal(view.branch, 'main');
    assert.deepEqual(rows(view.outgoing), ['docs:added', 'planner:added', 'review:added']);
    assert.equal(view.pushBlocked, undefined, 'an empty repo can take a push at once');
    const pushed = await pushRepo(first, { from: 'test machine' });
    assert.equal(pushed.stopped, undefined);
    assert.match(pushed.pushed!.subject, /Central Knot: update planner, docs, review/);
    view = live(pushed.view);
    assert.deepEqual([view.incoming, view.outgoing], [[], []]);
    // The layout, as anyone browsing the repo sees it; a file the repo would .gitignore still goes, as-is.
    assert.deepEqual(git(box.remote, 'ls-tree', '-r', '--name-only', 'main').split('\n'), ['agents/planner.md', 'mcp/docs.json', 'skills/review/SKILL.md', 'skills/review/notes.log']);
    assert.deepEqual(JSON.parse(git(box.remote, 'show', 'main:mcp/docs.json')), { type: 'stdio', command: 'docs-server', args: ['--port', '7'], env: { TOKEN: 'abc' } });
    assert.match(git(box.remote, 'show', 'main:agents/planner.md'), /model: opus/, 'Claude Code’s own agent file goes as written');

    const second = await box.home('second');
    view = live((await connectRepo(second, box.remote, '')).view);
    assert.deepEqual(rows(view.incoming), ['docs:added', 'planner:added', 'review:added']);
    assert.equal((await manageView(second)).skills.length, 0, 'connecting writes nothing to the tools');
    const pulled = await pullRepo(second);
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
    const added = (await readHistory(second.home)).find(event => event.key === 'review')!;
    assert.deepEqual([added.kind, added.via, added.losers.map(loser => loser.tool).sort()], ['added', 'repo', tools]);
    assert.equal((await restoreFromHistory(second, added.id)).stopped, undefined);
    assert.equal((await manageView(second)).skills.length, 0, 'Undo add takes back every copy Pull made');
  } finally { await box.cleanup(); }
});

test('An MCP server edited and an agent deleted on one computer arrive on the other through Pull', async () => {
  const box = await world();
  try {
    const first = await box.home('first');
    await seeded(first);
    await connectRepo(first, box.remote, '');
    await pushRepo(first);
    const second = await box.home('second');
    await connectRepo(second, box.remote, '');
    await pullRepo(second);

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

    await writeFile(join(first.home, '.claude/skills/review/SKILL.md'), skillText('review', 'From the first computer.'));
    await applyChanges(first, []);
    const view = live(await repoView(first, { check: true }));
    assert.deepEqual(view.incoming.map(row => [row.name, row.change, row.alsoHere]), [['review', 'changed', 'changed']]);
    assert.match(view.pushBlocked ?? '', /Pull them first/);
    assert.match((await pushRepo(first)).stopped ?? '', /Pull them first/, 'a push never overwrites a commit this computer hasn’t seen');

    assert.equal((await pullRepo(first)).stopped, undefined);
    for (const root of ['.claude/skills', '.copilot/skills']) assert.match(await readFile(join(first.home, root, 'review/SKILL.md'), 'utf8'), /From the second computer/);
    const pulled = (await readHistory(first.home)).filter(event => event.via === 'repo').at(-1)!;
    assert.equal(pulled.kind, 'chosen');
    assert.equal((await restoreFromHistory(first, pulled.id)).stopped, undefined);
    for (const root of ['.claude/skills', '.copilot/skills']) assert.match(await readFile(join(first.home, root, 'review/SKILL.md'), 'utf8'), /From the first computer/);
    assert.deepEqual(rows(live(await repoView(first)).outgoing), ['review:changed'], 'the undone pull is a change here, ready to push');
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

test('Only the layout is Central Knot’s: other files stay, an item that can’t be brought in stays as the repo has it', async () => {
  const box = await world();
  try {
    const author = join(box.base, 'author');
    execFileSync('git', ['clone', '--quiet', box.remote, author]);
    await mkdir(join(author, 'skills/linked'), { recursive: true });
    await writeFile(join(author, 'README.md'), 'My agent setup.\n');
    await writeFile(join(author, 'skills/README.md'), 'One folder per skill.\n');
    await writeFile(join(author, 'skills/linked/SKILL.md'), skillText('linked'));
    execFileSync('ln', ['-s', 'SKILL.md', join(author, 'skills/linked/alias.md')]);
    git(author, 'add', '-A'); git(author, '-c', 'user.name=a', '-c', 'user.email=a@b', 'commit', '--quiet', '-m', 'start'); git(author, 'push', '--quiet', 'origin', 'HEAD:main');

    const here = await box.home('here');
    await skill(here, '.claude/skills', 'mine');
    await applyChanges(here, [{ key: 'mine', managed: true, off: [] }]);
    let view = live((await connectRepo(here, box.remote, 'main')).view);
    assert.deepEqual(view.incoming.map(row => [row.name, !!row.held]), [['linked', true]]);
    await pullRepo(here);
    assert.equal((await manageView(here)).skills.some(item => item.key === 'linked'), false, 'a link is never put in a tool');
    view = live((await pushRepo(here)).view);
    assert.deepEqual(git(box.remote, 'ls-tree', '-r', '--name-only', 'main').split('\n'), ['README.md', 'skills/README.md', 'skills/linked/SKILL.md', 'skills/linked/alias.md', 'skills/mine/SKILL.md']);
    assert.deepEqual(view.outgoing, []);
  } finally { await box.cleanup(); }
});

test('The base instructions travel as instructions/base.md when this build has them', async () => {
  const box = await world();
  try {
    const store = new Map<string, string | undefined>([['first', 'Be brief.\n'], ['second', undefined]]);
    const baseFor = (name: string): BaseInstructions => ({ read: async () => store.get(name), apply: async text => { store.set(name, text); return undefined; } });
    const first = await box.home('first');
    await connectRepo(first, box.remote, '');
    assert.deepEqual(rows(live(await repoView(first, { base: baseFor('first') })).outgoing), ['Base instructions:added']);
    await pushRepo(first, { base: baseFor('first') });
    assert.equal(git(box.remote, 'show', 'main:instructions/base.md'), 'Be brief.');
    const second = await box.home('second');
    await connectRepo(second, box.remote, '');
    assert.deepEqual(rows(live(await repoView(second)).incoming), [], 'a build without base instructions leaves the file alone');
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
    assert.match((await connectRepo(reader, `${url}/missing.git`, '')).stopped ?? '', /No access, or no repository there/);
    assert.match((await connectRepo(reader, `${url}/config.git`, 'nope')).stopped ?? '', /no branch named “nope”/);
    assert.equal((await repoView(reader)).connected, false);
    assert.equal((await connectRepo(reader, `${url}/config.git`, 'main')).stopped, undefined);
    await pullRepo(reader);
    await writeFile(join(reader.home, '.claude/skills/review/SKILL.md'), skillText('review', 'Local only.'));
    await applyChanges(reader, []);
    assert.match((await pushRepo(reader)).stopped ?? '', /did not accept the push/);
    assert.deepEqual(rows(live(await repoView(reader)).outgoing), ['review:changed'], 'a refused push changes nothing here');
    const gone = await disconnectRepo(reader);
    assert.equal(gone.view.connected, false);
    assert.match(await readFile(join(reader.home, '.claude/skills/review/SKILL.md'), 'utf8'), /Local only/, 'disconnecting leaves the tools as they are');
  } finally { server.kill(); await box.cleanup(); }
});
