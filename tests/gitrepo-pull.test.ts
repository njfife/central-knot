import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, readFile, rename, rm, symlink, utimes, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { connectRepo, pullRepo, pushRepo, repoView } from '../src/gitrepo.ts';
import { readHistory } from '../src/history.ts';
import { applyMcp, mcpView } from '../src/mcp.ts';
import { agentsView, applyAgents, restoreAgent } from '../src/agents.ts';
import { tools, skillText, git, world, skill, live, rows, seedServerAndAgent, serverAndAgentOnTwo, edit, oneSkillAndAnAuthor, applySkillsIn, restoreIn, skillsLibrary } from './gitrepo-world.ts';

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
    // A server's last copy gone counts as deleted once it has stayed gone a while (it may only be unreadable for a moment).
    await applyMcp(first, tools, [], { settleMs: 0, now: Date.now() + 86_400_000 });
    // An agent leaves the repo only by Delete from Central Knot.
    await applyAgents(first, tools, [{ key: 'planner', managed: true, off: [], deleted: true }]);
    assert.deepEqual(rows(live(await repoView(first)).outgoing), ['docs:removed', 'planner:removed']);
    await pushRepo(first);

    const syncState = async (syncOn: boolean) => live(await repoView(second, { check: true, syncOn })).incoming.map(row => [row.name, row.sync, !!row.retry]);
    assert.deepEqual(await syncState(false), [['planner', 'waits', false], ['docs', 'waits', false]], 'said before Pull, not discovered by it');
    const waited = await pullRepo(second, { syncOn: false });
    assert.equal(waited.pulled, 0);
    assert.equal(Object.keys((await agentsView(second, tools)).items[0].copies).length, 2, 'no copy removed while the deletion waits');
    assert.ok((await mcpView(second, tools)).servers.some(server => server.key === 'docs'));
    assert.deepEqual(await syncState(false), [['planner', 'waits', true], ['docs', 'waits', true]]);
    assert.deepEqual(await syncState(true), [['planner', 'ready', true], ['docs', 'ready', true]]);
    const view = live((await pullRepo(second, { syncOn: true })).view);
    assert.deepEqual([view.incoming, view.outgoing], [[], []]);
    assert.deepEqual([(await mcpView(second, tools)).servers.length, (await agentsView(second, tools)).items.length], [0, 0]);
    const deleted = (await readHistory(second)).filter(event => event.key === 'agent:planner' && event.kind === 'deleted').at(-1)!;
    assert.equal(deleted.cause, 'pulled', 'Pull did it, said by the entry itself');
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

test('A skill only one tool has: Pull replaces that copy, and Undo in History puts it back; a SKILL.md that stops parsing can’t be read for sure, so it is never a removal', async () => {
  const box = await world();
  try {
    const { first, author, commit } = await oneSkillAndAnAuthor(box, { off: ['copilot-cli'] });
    await writeFile(join(author, 'skills/solo/SKILL.md'), skillText('solo', 'After.'));
    commit('edit');
    await pullRepo(first);
    assert.match(await readFile(join(first.home, '.claude/skills/solo/SKILL.md'), 'utf8'), /After/);
    const pulled = (await readHistory(first)).find(event => event.key === 'solo' && event.via === 'repo')!;
    assert.equal((await restoreIn(first, pulled.id)).stopped, undefined);
    assert.match(await readFile(join(first.home, '.claude/skills/solo/SKILL.md'), 'utf8'), /Before/);
    // The Undo made the version from before the pull current: that is what Push would send.
    assert.deepEqual(rows(live(await repoView(first)).outgoing), ['solo:changed']);
    // A SKILL.md that stops parsing is a copy that can't be read: it changes nothing, and is never offered as a removal.
    await writeFile(join(first.home, '.claude/skills/solo/SKILL.md'), '---\nname: solo\ndescription: Has: a colon\n---\n');
    assert.deepEqual(rows(live(await repoView(first)).outgoing), ['solo:changed']);
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

test('Pull counts and says only its own items: another skill in Central Knot held for its own reason doesn’t make a pulled one look stuck', async () => {
  const box = await world();
  try {
    const { first, author, commit } = await oneSkillAndAnAuthor(box);
    await skill(first, '.claude/skills', 'linked');
    await applySkillsIn(first, [{ key: 'linked', managed: true, off: [] }]);
    await symlink('SKILL.md', join(first.home, '.claude/skills/linked/alias.md'));
    await mkdir(join(author, 'skills/fresh'), { recursive: true });
    await writeFile(join(author, 'skills/fresh/SKILL.md'), skillText('fresh'));
    commit('fresh');
    const pulled = await pullRepo(first);
    assert.equal(pulled.pulled, 1);
    assert.ok(!pulled.results.some(result => result.item === 'linked'), 'the held bystander is not in Pull’s results');
  } finally { await box.cleanup(); }
});

test('A skill of the repo’s name that is only found here: the row says so, Pull takes the repo’s in and keeps this one as a version, which can be made current again', async () => {
  const box = await world();
  try {
    const first = await box.home('first');
    await skill(first, '.claude/skills', 'review', skillText('review', 'Shared.'));
    await applySkillsIn(first, [{ key: 'review', managed: true, off: [] }]);
    await connectRepo(first, box.remote, '');
    await pushRepo(first);
    const second = await box.home('second');
    await skill(second, '.claude/skills', 'review', skillText('review', 'Mine.'));
    const view = live((await connectRepo(second, box.remote, '')).view);
    assert.deepEqual(view.incoming.map(row => [row.name, row.change, row.alsoHere]), [['review', 'added', 'unmanaged']]);
    await pullRepo(second);
    for (const root of ['.claude/skills', '.copilot/skills']) assert.match(await readFile(join(second.home, root, 'review/SKILL.md'), 'utf8'), /Shared/);
    // Taken into Central Knot from the repo; the skill found here is kept first, as a copy that gave way to it.
    const item = (await skillsLibrary(second)).review;
    const mine = item.versions.find(version => version.from.how === 'was-in')!;
    assert.deepEqual([item.on, mine.from.harness, mine.from.replacedBy], [true, 'claude-cli', item.hash]);
    assert.equal((await applySkillsIn(second, [{ key: 'review', managed: true, off: [], version: mine.hash }])).stopped, undefined, 'and can be made current again');
    assert.match(await readFile(join(second.home, '.claude/skills/review/SKILL.md'), 'utf8'), /Mine/);
  } finally { await box.cleanup(); }
});

test('Pull brings an agent into Central Knot as a version pulled from the Git repo; a different agent of that name found here is kept first, as a copy that gave way to it', async () => {
  const box = await world();
  try {
    const first = await box.home('first');
    await seedServerAndAgent(first);
    await connectRepo(first, box.remote, '');
    await pushRepo(first);
    const second = await box.home('second');
    // The second computer has its own planner in Copilot CLI, which Central Knot there never took in.
    await mkdir(join(second.home, '.copilot/agents'), { recursive: true });
    await writeFile(join(second.home, '.copilot/agents/planner.agent.md'), '---\nname: planner\ndescription: Plans work.\n---\n\nPlan loosely.\n');
    await connectRepo(second, box.remote, '');
    await pullRepo(second);
    const planner = (await agentsView(second, tools)).library!.planner;
    assert.deepEqual([planner.on, planner.versions.map(version => version.from.how), planner.versions[1].from.replacedBy], [true, ['pulled', 'was-in'], planner.hash]);
    for (const file of ['.claude/agents/planner.md', '.copilot/agents/planner.agent.md']) assert.match(await readFile(join(second.home, file), 'utf8'), /Plan carefully/);
    // The planner found here is still there to go back to.
    const { agentVersion } = await import('../src/agents.ts');
    assert.equal((await agentVersion(second, 'planner', planner.versions[1].hash))?.prompt, 'Plan loosely.\n');
  } finally { await box.cleanup(); }
});

test('Pull over an edit made here that sync had not taken in yet: the edit is a version before its file is written over', async () => {
  const box = await world();
  try {
    const { first, second, firstPlanner, secondPlanner } = await serverAndAgentOnTwo(box);
    await edit(firstPlanner, 'Plan carefully.', 'Plan in small steps.');
    await applyAgents(first, tools, []);
    await pushRepo(first);
    // Edited on the second computer with Automatic sync off: no pass has seen it.
    await edit(secondPlanner, 'Plan carefully.', 'Plan boldly.');
    await pullRepo(second, { syncOn: false });
    const planner = (await agentsView(second, tools)).library!.planner;
    const { agentVersion } = await import('../src/agents.ts');
    const prompts = await Promise.all(planner.versions.map(async version => (await agentVersion(second, 'planner', version.hash))?.prompt.trim()));
    assert.ok(prompts.includes('Plan boldly.'), `the edit is among the versions: ${prompts.join(' | ')}`);
    assert.match(await readFile(secondPlanner, 'utf8'), /Plan in small steps|Plan boldly/);
  } finally { await box.cleanup(); }
});

test('Pull into an agent that is Off here: the repo’s version becomes its current version and it stays Off; turned on, every tool gets that version', async () => {
  const box = await world();
  try {
    const { first, second, firstPlanner, secondPlanner } = await serverAndAgentOnTwo(box);
    await applyAgents(second, tools, [{ key: 'planner', managed: false, off: [] }]);
    await edit(firstPlanner, 'Plan carefully.', 'Plan in small steps.');
    await edit(firstPlanner, 'model: opus', 'model: sonnet');
    await applyAgents(first, tools, []);
    await pushRepo(first);
    const pulled = await pullRepo(second);
    assert.deepEqual([pulled.stopped, pulled.pulled], [undefined, 1]);
    const { agentVersion } = await import('../src/agents.ts');
    const planner = (await agentsView(second, tools)).library!.planner;
    assert.deepEqual([planner.on, (await agentVersion(second, 'planner', planner.hash))?.prompt, planner.versions[0].from], [false, 'Plan in small steps.\n', { how: 'pulled' }]);
    assert.equal(await readFile(secondPlanner, 'utf8').catch(() => undefined), undefined, 'an Off agent stays out of every tool');
    // Nothing goes back: the repo and this computer hold the same version.
    const after = live(await repoView(second, { check: true }));
    assert.deepEqual([rows(after.incoming), rows(after.outgoing)], [[], []]);
    // History's entry makes the version from before the pull current again; On puts the pulled one in every tool, Claude Code's
    // file with its own settings as the repo has them.
    const entry = (await readHistory(second)).filter(event => event.key === 'agent:planner').at(-1)!;
    assert.deepEqual([entry.kind, entry.cause], ['edit', 'pulled']);
    await applyAgents(second, tools, [{ key: 'planner', managed: true, off: [], seenManaged: false }]);
    assert.match(await readFile(secondPlanner, 'utf8'), /^---\nname: planner\ndescription: Plans work\.\nmodel: sonnet\n---\n\nPlan in small steps\.\n$/);
    assert.match(await readFile(join(second.home, '.copilot/agents/planner.agent.md'), 'utf8'), /Plan in small steps/);
  } finally { await box.cleanup(); }
});

test('An agent turned Off here stays in the repo at the next Push: the other computer’s Pull changes nothing there; only Delete takes it out', async () => {
  const box = await world();
  try {
    const { first, second, firstPlanner } = await serverAndAgentOnTwo(box);
    await applyAgents(second, tools, [{ key: 'planner', managed: false, off: [] }]);
    assert.deepEqual(rows(live(await repoView(second, { check: true })).outgoing), [], 'Off here is nothing to send');
    await pushRepo(second);
    await pullRepo(first);
    assert.deepEqual([(await agentsView(first, tools)).library!.planner.on, await readFile(firstPlanner, 'utf8').then(() => true)], [true, true]);
    // Delete from Central Knot is what leaves the repo, and the other computer's Pull deletes it there, Off or On.
    await applyAgents(first, tools, [{ key: 'planner', managed: false, off: [] }]);
    await applyAgents(second, tools, [{ key: 'planner', managed: false, off: [], deleted: true }]);
    assert.deepEqual(rows(live(await repoView(second, { check: true })).outgoing), ['planner:removed']);
    await pushRepo(second);
    await pullRepo(first);
    assert.equal((await agentsView(first, tools)).library!.planner.deleted !== undefined, true);
  } finally { await box.cleanup(); }
});

test('Pull of only Claude Code’s settings for an agent that is Off here has its History line; Claude Code gets them when it is turned on', async () => {
  const box = await world();
  try {
    const { first, second, firstPlanner, secondPlanner } = await serverAndAgentOnTwo(box);
    await applyAgents(second, tools, [{ key: 'planner', managed: false, off: [] }]);
    await edit(firstPlanner, 'model: opus', 'model: haiku');
    await applyAgents(first, tools, []);
    await pushRepo(first);
    const versions = (await agentsView(second, tools)).library!.planner.versions.length;
    assert.equal((await pullRepo(second)).pulled, 1);
    const entry = (await readHistory(second)).filter(event => event.key === 'agent:planner').at(-1)!;
    assert.deepEqual([entry.kind, entry.cause, entry.previous], ['edit', 'pulled', undefined]);
    assert.equal((await agentsView(second, tools)).library!.planner.versions.length, versions, 'the same version is not listed again');
    await applyAgents(second, tools, [{ key: 'planner', managed: true, off: [], seenManaged: false }]);
    assert.match(await readFile(secondPlanner, 'utf8'), /model: haiku/);
  } finally { await box.cleanup(); }
});

test('Pull leaves a Claude Code copy Central Knot doesn’t own as it is, and one holding an edit that won', async () => {
  const box = await world();
  try {
    const { first, second, firstPlanner, secondPlanner } = await serverAndAgentOnTwo(box);
    // Off here, with a copy made by hand in Claude Code: the repo's settings are not written into it.
    await applyAgents(second, tools, [{ key: 'planner', managed: false, off: [] }]);
    const handMade = '---\nname: planner\ndescription: Plans work.\n---\n\nPlan carefully.\n';
    await writeFile(secondPlanner, handMade);
    await edit(firstPlanner, 'model: opus', 'model: sonnet');
    await applyAgents(first, tools, []);
    await pushRepo(first);
    await pullRepo(second);
    assert.equal(await readFile(secondPlanner, 'utf8'), handMade);
    // On here, with an edit in Claude Code newer than what Pull brings: the edit wins, and Pull doesn't write over it.
    await rm(secondPlanner);
    await applyAgents(second, tools, [{ key: 'planner', managed: true, off: [], seenManaged: false }]);
    await edit(firstPlanner, 'Plan carefully.', 'Plan from the repo.');
    await applyAgents(first, tools, []);
    await pushRepo(first);
    await edit(secondPlanner, 'Plan carefully.', 'Plan here.');
    const later = new Date(Date.now() + 60_000);
    await utimes(secondPlanner, later, later);
    await pullRepo(second, { syncOn: false });
    assert.match(await readFile(secondPlanner, 'utf8'), /Plan here\./);
  } finally { await box.cleanup(); }
});

test('Push sends an edit made in a tool that no pass has taken in, as a click would take it in; another computer’s Pull gets it', async () => {
  const box = await world();
  try {
    const { first, second, firstPlanner, secondPlanner } = await serverAndAgentOnTwo(box);
    // Automatic sync off: no pass runs after the edit.
    await edit(firstPlanner, 'Plan carefully.', 'Plan in small steps.');
    assert.deepEqual(rows(live(await repoView(first, { check: true, syncOn: false })).outgoing), ['planner:changed']);
    assert.equal((await pushRepo(first, { syncOn: false })).stopped, undefined);
    await pullRepo(second);
    assert.match(await readFile(secondPlanner, 'utf8'), /Plan in small steps\./);
  } finally { await box.cleanup(); }
});

test('Push of an agent that is Off here sends Claude Code’s own settings as Central Knot last saw them', async () => {
  const box = await world();
  try {
    const { first, firstPlanner } = await serverAndAgentOnTwo(box);
    await edit(firstPlanner, 'model: opus', 'model: sonnet');
    await applyAgents(first, tools, []);
    await applyAgents(first, tools, [{ key: 'planner', managed: false, off: [] }]);
    await pushRepo(first);
    assert.match(git(box.remote, 'show', 'main:agents/planner.md'), /model: sonnet/);
  } finally { await box.cleanup(); }
});
