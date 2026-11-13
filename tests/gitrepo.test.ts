import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { connectRepo, pullRepo, pushRepo, repoView, undoSettingsChange } from '../src/gitrepo.ts';
import { readHistory } from '../src/history.ts';
import { applyServers, restoreServer, serversView } from '../src/servers.ts';
import { agentsView, applyAgents, restoreAgent } from '../src/agents.ts';
import { tools, git, world, skill, live, rows, seedServerAndAgent, serverAndAgentOnTwo, edit, applySkillsIn, skillRows, restoreIn } from './gitrepo-world.ts';

test('Push puts the Managed set in the repo’s layout; another computer pulls it into its tools, Managed, and is then up to date', async () => {
  const box = await world();
  try {
    const first = await box.home('first');
    await skill(first, '.claude/skills', 'review');
    await writeFile(join(first.home, '.claude/skills/review/notes.log'), 'kept as-is\n');
    assert.ok(!(await applySkillsIn(first, [{ key: 'review', managed: true, off: [] }])).stopped);
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
    // The repo is sent each agent's current version from Central Knot's library, so copies no tool can read just now change nothing.
    const planners = [join(first.home, '.copilot/agents/planner.agent.md'), join(first.home, '.claude/agents/planner.md')];
    const kept = await Promise.all(planners.map(file => readFile(file, 'utf8')));
    for (const file of planners) await writeFile(file, 'half saved');
    assert.deepEqual(live(await repoView(first)).outgoing, []);
    for (const [index, file] of planners.entries()) await writeFile(file, kept[index]);

    const second = await box.home('second');
    view = live((await connectRepo(second, box.remote, '')).view);
    assert.deepEqual(rows(view.incoming), ['docs:added', 'planner:added', 'review:added']);
    assert.equal((await skillRows(second)).length, 0, 'connecting writes nothing to the tools');
    // With Sync off, Pull still does what it shows (each item's pass runs for that item alone).
    const pulled = await pullRepo(second, { syncOn: false });
    assert.equal(pulled.stopped, undefined);
    assert.equal(pulled.pulled, 3);
    for (const root of ['.claude/skills', '.copilot/skills']) assert.equal(await readFile(join(second.home, root, 'review/notes.log'), 'utf8'), 'kept as-is\n');
    assert.ok((await skillRows(second)).find(item => item.key === 'review')!.on);
    const docs = (await serversView(second, tools)).items.find(server => server.key === 'docs')!;
    assert.ok(docs.on && docs.copies['copilot-cli']);
    assert.deepEqual(docs.waits, ['claude-cli'], 'Claude Code gets it with Write to Claude Code');
    assert.ok((await agentsView(second, tools)).items.find(agent => agent.key === 'planner')!.on);
    assert.deepEqual((await agentsView(second, tools)).library!.planner.versions.map(version => version.from), [{ how: 'pulled' }], 'its version says where it came from');
    assert.match(await readFile(join(second.home, '.claude/agents/planner.md'), 'utf8'), /model: opus/);
    view = live(pulled.view);
    assert.deepEqual([view.incoming, view.outgoing, view.base?.id], [[], [], view.latest?.id]);
    // A skill, an MCP server or an agent Pull brought in is in Central Knot now: its entry turns it off, which takes it out of
    // every tool and keeps it.
    const addedBy = (key: string, kind = 'added') => readHistory(second).then(events => events.find(event => event.key === key && event.kind === kind)!);
    const serverIn = await addedBy('mcp:docs', 'on');
    assert.deepEqual([serverIn.via, serverIn.cause], ['repo', 'pulled']);
    assert.equal((await restoreServer(second, tools, serverIn.id)).stopped, undefined);
    const skillIn = await addedBy('review', 'on');
    assert.deepEqual([skillIn.via, skillIn.cause, skillIn.losers.map(loser => loser.tool).sort()], ['repo', 'pulled', tools]);
    assert.equal((await restoreIn(second, skillIn.id)).stopped, undefined);
    const takenIn = await addedBy('agent:planner', 'on');
    assert.deepEqual([takenIn.via, takenIn.cause], ['repo', 'pulled']);
    assert.equal((await restoreAgent(second, tools, takenIn.id)).stopped, undefined);
    assert.deepEqual((await serversView(second, tools)).items.map(server => [server.key, server.on, Object.keys(server.copies)]), [['docs', false, []]]);
    assert.deepEqual((await skillRows(second)).map(item => [item.key, item.on, Object.keys(item.copies)]), [['review', false, []]]);
    assert.deepEqual((await agentsView(second, tools)).items.map(agent => [agent.key, agent.on, Object.keys(agent.copies)]), [['planner', false, []]]);
  } finally { await box.cleanup(); }
});

test('An MCP server’s edit and an agent setting only Claude Code has arrive through Pull; that setting’s Pull has its own Undo and Redo', async () => {
  const box = await world();
  try {
    const { first, second, firstPlanner, secondPlanner } = await serverAndAgentOnTwo(box);
    await writeFile(join(first.home, '.copilot/mcp-config.json'), JSON.stringify({ mcpServers: { docs: { type: 'local', command: 'docs-server', args: ['--port', '8'], env: { TOKEN: 'abc' }, tools: ['*'] } } }));
    await applyServers(first, tools, [], { settleMs: 0 });
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

test('A repo change to an agent comes in though one tool’s copy can’t be read just now; that tool gets it once its copy reads again', async () => {
  const box = await world();
  try {
    const { first, second, firstPlanner, secondPlanner } = await serverAndAgentOnTwo(box);
    const secondCopilot = join(second.home, '.copilot/agents/planner.agent.md');
    const readable = await readFile(secondCopilot, 'utf8');
    await writeFile(secondCopilot, 'half saved');
    await edit(firstPlanner, 'Plan carefully.', 'Plan in small steps.');
    await applyAgents(first, tools, []);
    await pushRepo(first);
    assert.equal((await pullRepo(second)).pulled, 1);
    assert.match(await readFile(secondPlanner, 'utf8'), /Plan in small steps/);
    assert.equal(await readFile(secondCopilot, 'utf8'), 'half saved', 'a copy that can’t be read is never written over');
    await writeFile(secondCopilot, readable);
    await applyAgents(second, tools, []);
    assert.match(await readFile(secondCopilot, 'utf8'), /Plan in small steps/);
  } finally { await box.cleanup(); }
});

test('Push sends every server in Central Knot, On or Off, with Claude Code’s own fields for it; a server only found is not sent', async () => {
  const box = await world();
  try {
    const first = await box.home('first');
    await writeFile(join(first.home, '.claude.json'), JSON.stringify({ mcpServers: { docs: { type: 'stdio', command: 'docs-server', timeout: 30 }, found: { type: 'stdio', command: 'found-server' } } }));
    await writeFile(join(first.home, '.copilot/mcp-config.json'), JSON.stringify({ mcpServers: { off: { type: 'local', command: 'off-server', tools: ['*'] } } }));
    assert.ok(!(await applyServers(first, tools, [{ key: 'docs', managed: true, off: [] }, { key: 'off', managed: true, off: [] }])).stopped);
    assert.ok(!(await applyServers(first, tools, [{ key: 'off', managed: false, off: [], seenManaged: true }])).stopped);
    await connectRepo(first, box.remote, '');
    await pushRepo(first);
    assert.deepEqual(git(box.remote, 'ls-tree', '-r', '--name-only', 'main').split('\n').filter(path => path.startsWith('mcp/')), ['mcp/docs.json', 'mcp/off.json']);
    assert.deepEqual(JSON.parse(git(box.remote, 'show', 'main:mcp/docs.json')), { type: 'stdio', command: 'docs-server', timeout: 30 });
  } finally { await box.cleanup(); }
});
