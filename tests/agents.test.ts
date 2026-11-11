import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmod, mkdir, mkdtemp, readFile, readdir, realpath, rename, rm, utimes, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { agentText, agentsView, applyAgents, readAgentRecord, readAgents, restoreAgent } from '../src/agents.ts';
import { readHistory } from '../src/manage.ts';
import { readRecord, syncGate, type ShareContext } from '../src/share.ts';
import { chooseTools } from '../src/toolchoice.ts';
import type { HarnessId } from '../src/types.ts';
import { readTomlTables } from '../src/textedit.ts';

const tools: HarnessId[] = ['claude-cli', 'copilot-cli', 'codex-cli'];
async function sandbox() {
  const base = await realpath(await mkdtemp(join(tmpdir(), 'ck-agents-')));
  const home = join(base, 'home');
  for (const folder of ['.claude/agents', '.copilot/agents', '.codex/agents']) await mkdir(join(home, folder), { recursive: true });
  const context: ShareContext = { home, mode: 'custom', read: async () => [], build: 'test', settingsPath: join(base, 'settings.json'), realHome: join(base, 'real') };
  return { base, home, context, cleanup: () => rm(base, { recursive: true, force: true }) };
}
const claudeAgent = (prompt = 'You review code.\nBe brief.\n', extra = '') => `---\nname: reviewer\ndescription: Reviews code\n${extra}---\n\n${prompt}`;
const read = (home: string, path: string) => readFile(join(home, path), 'utf8');

test('A plain Claude agent reaches Copilot and Codex in their own formats, and is two-way', async () => {
  const box = await sandbox();
  try {
    await writeFile(join(box.home, '.claude/agents/reviewer.md'), claudeAgent());
    const result = await applyAgents(box.context, tools, [{ key: 'reviewer', managed: true, off: [] }]);
    assert.equal(result.writes, 2, JSON.stringify(result.results));
    assert.equal(await read(box.home, '.copilot/agents/reviewer.agent.md'), '---\nname: reviewer\ndescription: Reviews code\n---\n\nYou review code.\nBe brief.\n');
    const toml = await read(box.home, '.codex/agents/reviewer.toml');
    const root = readTomlTables(toml)[0].entries;
    assert.equal(root.find(entry => entry.key === 'developer_instructions')?.value, 'You review code.\nBe brief.\n');
    const view = await agentsView(box.context, tools);
    assert.deepEqual(view.servers[0].limits, {});
    // An edit in Codex spreads back to Claude and Copilot (two-way, TRN-02).
    await writeFile(join(box.home, '.codex/agents/reviewer.toml'), toml.replace('Be brief.', 'Be thorough.'));
    const back = await applyAgents(box.context, tools, []);
    assert.equal(back.writes, 2, JSON.stringify(back.results));
    assert.match(await read(box.home, '.claude/agents/reviewer.md'), /Be thorough\./);
    assert.match(await read(box.home, '.copilot/agents/reviewer.agent.md'), /Be thorough\./);
    assert.equal(back.notices?.[0].kind, 'edit');
    assert.equal(back.notices?.[0].winner, 'codex-cli');
    assert.equal((await applyAgents(box.context, tools, [])).writes, 0, 'settled');
  } finally { await box.cleanup(); }
});

test('Claude-only fields make the others one-way With limits; an edit there stays local and stops updates there', async () => {
  const box = await sandbox();
  try {
    await writeFile(join(box.home, '.claude/agents/reviewer.md'), claudeAgent(undefined, 'tools: Read, Grep\nmodel: opus\n'));
    const view = await agentsView(box.context, tools);
    assert.match(view.servers[0].limits?.['copilot-cli'] ?? '', /One-way from Claude Code\. Copilot CLI has no setting for Claude Code's “tools” or “model”/);
    assert.match(view.servers[0].limits?.['codex-cli'] ?? '', /One-way/);
    assert.equal(view.servers[0].limits?.['claude-cli'], undefined);
    await applyAgents(box.context, tools, [{ key: 'reviewer', managed: true, off: [] }]);
    const copilot = await read(box.home, '.copilot/agents/reviewer.agent.md');
    assert.ok(!copilot.includes('tools:') && !copilot.includes('model:'), 'no invented equivalent');
    // Edit in Copilot (one-way), to a field only: stays there, Claude untouched, Copilot no longer updated.
    await writeFile(join(box.home, '.copilot/agents/reviewer.agent.md'), copilot.replace('description: Reviews code\n', 'description: Reviews code\nmodel: my-local-model\n'));
    const held = await applyAgents(box.context, tools, []);
    assert.equal(held.writes, 0);
    assert.match(held.results[0].message, /stopped updating it there; nothing spread/);
    assert.match(await read(box.home, '.claude/agents/reviewer.md'), /Be brief\./);
    assert.deepEqual((await agentsView(box.context, tools)).servers[0].stopped, ['copilot-cli']);
    // The origin's edit still reaches Codex, not the stopped Copilot copy.
    await writeFile(join(box.home, '.claude/agents/reviewer.md'), claudeAgent('New prompt.\n', 'tools: Read, Grep\nmodel: opus\n'));
    const onward = await applyAgents(box.context, tools, []);
    assert.equal(onward.writes, 1, JSON.stringify(onward.results));
    assert.match(await read(box.home, '.codex/agents/reviewer.toml'), /New prompt\./);
    assert.match(await read(box.home, '.copilot/agents/reviewer.agent.md'), /model: my-local-model\n---\n\nYou review code\.\nBe brief\./);
    // Deleting the one-way Codex copy deletes nothing elsewhere.
    await rm(join(box.home, '.codex/agents/reviewer.toml'));
    await applyAgents(box.context, tools, [], { settleMs: 0 });
    assert.match(await read(box.home, '.claude/agents/reviewer.md'), /New prompt\./);
  } finally { await box.cleanup(); }
});

test('A tool managed again starts from its own agents: an edit or deletion made there while it was left out does not spread', async () => {
  for (const change of ['edit', 'delete'] as const) {
    const box = await sandbox();
    try {
      await writeFile(join(box.home, '.claude/agents/reviewer.md'), claudeAgent());
      await applyAgents(box.context, tools, [{ key: 'reviewer', managed: true, off: [] }]);
      // Left out, and changed there with no pass in between (Sync off).
      await chooseTools(box.context, ['claude-cli', 'codex-cli']);
      const copilot = join(box.home, '.copilot/agents/reviewer.agent.md');
      if (change === 'edit') await writeFile(copilot, (await readFile(copilot, 'utf8')).replace('Be brief.', 'Be long.')); else await rm(copilot);
      await chooseTools(box.context, tools);
      await applyAgents(box.context, tools, [], { settleMs: 0 });
      await applyAgents(box.context, tools, [], { settleMs: 0 });
      assert.match(await read(box.home, '.claude/agents/reviewer.md'), /Be brief\./, `the ${change} in Copilot did not spread`);
      assert.match(await readFile(copilot, 'utf8'), change === 'edit' ? /Be long\./ : /Be brief\./, 'Copilot keeps its edit, or gets the agent back');
    } finally { await box.cleanup(); }
  }
});

test('With an agent’s origin left out, the tools that remain sync it with each other', async () => {
  const box = await sandbox();
  try {
    // Claude-only fields make the other two copies one-way from Claude Code.
    await writeFile(join(box.home, '.claude/agents/reviewer.md'), claudeAgent(undefined, 'tools: Read, Grep\nmodel: opus\n'));
    await applyAgents(box.context, tools, [{ key: 'reviewer', managed: true, off: [] }]);
    const rest: HarnessId[] = ['copilot-cli', 'codex-cli'];
    await chooseTools(box.context, rest);
    await applyAgents(box.context, rest, [], { settleMs: 0 });
    const copilot = join(box.home, '.copilot/agents/reviewer.agent.md');
    await writeFile(copilot, (await readFile(copilot, 'utf8')).replace('Be brief.', 'Be long.'));
    const spread = await applyAgents(box.context, rest, [], { settleMs: 0 });
    assert.match(await read(box.home, '.codex/agents/reviewer.toml'), /Be long\./, JSON.stringify(spread.results));
    assert.match(await read(box.home, '.claude/agents/reviewer.md'), /Be brief\./, 'Claude Code, left out, is not written');
  } finally { await box.cleanup(); }
});

test('Updating a copy keeps that tool’s own fields, comments and tables', async () => {
  const box = await sandbox();
  try {
    // Codex's copy differs, so choosing Claude Code's is a choice of that copy (identical ones would take the one with the most fields).
    const codex = `# my agent\nname = "reviewer"\ndescription = "Reviews code"\nmodel = "gpt-6"\ndeveloper_instructions = """\nYou review code.\nBe quick.\n"""\n\n[mcp_servers.docs]\nurl = "https://example.com/mcp"\n`;
    await writeFile(join(box.home, '.codex/agents/reviewer.toml'), codex);
    await writeFile(join(box.home, '.claude/agents/reviewer.md'), claudeAgent());
    await applyAgents(box.context, tools, [{ key: 'reviewer', managed: true, off: [], use: 'claude-cli' }]);
    await writeFile(join(box.home, '.claude/agents/reviewer.md'), claudeAgent('Say "hi" with a \\ and """quotes"""\ttab.\n'));
    const result = await applyAgents(box.context, tools, []);
    assert.ok(result.results.some(entry => entry.harness === 'codex-cli' && entry.outcome === 'written'), JSON.stringify(result.results));
    const after = await read(box.home, '.codex/agents/reviewer.toml');
    assert.ok(after.startsWith('# my agent\nname = "reviewer"\ndescription = "Reviews code"\nmodel = "gpt-6"\n'), after);
    assert.ok(after.endsWith('\n[mcp_servers.docs]\nurl = "https://example.com/mcp"\n'), after);
    const back = await readAgents(box.context, 'codex-cli');
    assert.equal(back.entries[0].agent.prompt, 'Say "hi" with a \\ and """quotes"""\ttab.\n');
    // Claude frontmatter extras and comments survive an update from elsewhere.
    const claude = `---\n# keep me\nname: reviewer\ndescription: Reviews code\nhooks: {PreToolUse: [{matcher: Bash}]}\n---\n\nSay "hi" with a \\ and """quotes"""\ttab.\n`;
    assert.equal(agentText('claude-cli', { name: 'reviewer', description: 'Reviews code', prompt: 'x' }, claude), '---\n# keep me\nname: reviewer\ndescription: Reviews code\nhooks: {PreToolUse: [{matcher: Bash}]}\n---\n\nx');
  } finally { await box.cleanup(); }
});

test('A different agent with the same name (even in another case) needs a choice; a chosen copy replaces the other', async () => {
  const box = await sandbox();
  try {
    await writeFile(join(box.home, '.claude/agents/Reviewer.md'), claudeAgent());
    await writeFile(join(box.home, '.copilot/agents/reviewer.agent.md'), '---\nname: reviewer\ndescription: Copilot reviewer\n---\n\nOther prompt.\n');
    const held = await applyAgents(box.context, tools, [{ key: 'reviewer', managed: true, off: [] }]);
    assert.equal(held.writes, 0);
    assert.match(held.results[0].message, /Choose which copy/);
    const chosen = await applyAgents(box.context, tools, [{ key: 'reviewer', managed: true, off: [], use: 'claude-cli' }]);
    assert.equal(chosen.writes, 2, JSON.stringify(chosen.results));
    assert.match(await read(box.home, '.copilot/agents/reviewer.agent.md'), /Reviews code/);
    const chosenEvent = (await readHistory(box.context)).find(entry => entry.kind === 'chosen' && entry.key === 'agent:reviewer')!;
    assert.equal((await restoreAgent(box.context, tools, chosenEvent.id)).stopped, undefined);
    assert.match(await read(box.home, '.copilot/agents/reviewer.agent.md'), /Other prompt\./, 'the replaced copy comes back from History');
  } finally { await box.cleanup(); }
});

test('Deleting a two-way copy deletes everywhere after it settles; Restore brings it back; a missing tool folder is not a deletion', async () => {
  const box = await sandbox();
  try {
    await writeFile(join(box.home, '.claude/agents/reviewer.md'), claudeAgent());
    await applyAgents(box.context, tools, [{ key: 'reviewer', managed: true, off: [] }]);
    // The whole Codex agents folder goes away: nothing is deleted anywhere; once it is back, Codex's copy is put back.
    await rm(join(box.home, '.codex/agents'), { recursive: true });
    assert.equal((await applyAgents(box.context, tools, [], { settleMs: 0 })).writes, 0);
    assert.match(await read(box.home, '.claude/agents/reviewer.md'), /Be brief/);
    await mkdir(join(box.home, '.codex/agents'));
    assert.equal((await applyAgents(box.context, tools, [], { settleMs: 0 })).writes, 1);
    assert.match(await read(box.home, '.claude/agents/reviewer.md'), /Be brief/);
    assert.match(await read(box.home, '.codex/agents/reviewer.toml'), /Be brief/, 'put back');
    // A real deletion in Copilot: held while settling, then spread.
    await rm(join(box.home, '.copilot/agents/reviewer.agent.md'));
    assert.equal((await applyAgents(box.context, tools, [], { now: 1000, settleMs: 2000 })).writes, 0);
    const gone = await applyAgents(box.context, tools, [], { now: 4000, settleMs: 2000 });
    assert.equal(gone.writes, 2, JSON.stringify(gone.results));
    assert.deepEqual(await readdir(join(box.home, '.claude/agents')), []);
    assert.equal((await applyAgents(box.context, tools, [], { settleMs: 0 })).writes, 0, 'no revival');
    const event = (await readHistory(box.context)).find(entry => entry.kind === 'deleted' && entry.key === 'agent:reviewer');
    assert.ok(event);
    const restored = await restoreAgent(box.context, tools, event.id);
    assert.equal(restored.writes, 3, JSON.stringify(restored));
    assert.equal(await read(box.home, '.claude/agents/reviewer.md'), claudeAgent());
    assert.equal((await applyAgents(box.context, tools, [], { settleMs: 0 })).writes, 0);
  } finally { await box.cleanup(); }
});

test('Agents nobody managed are never written, and unreadable files are reported, not offered', async () => {
  const box = await sandbox();
  try {
    await writeFile(join(box.home, '.claude/agents/reviewer.md'), claudeAgent());
    await writeFile(join(box.home, '.claude/agents/broken.md'), 'no frontmatter');
    await writeFile(join(box.home, '.codex/agents/bad.toml'), 'name = ');
    await writeFile(join(box.home, '.codex/agents/empty.toml'), '');
    const view = await agentsView(box.context, tools);
    assert.deepEqual(view.servers.map(server => server.key), ['reviewer']);
    assert.equal(view.problems.length, 3);
    assert.equal((await applyAgents(box.context, tools, [])).writes, 0);
    assert.deepEqual(await readdir(join(box.home, '.copilot/agents')), []);
  } finally { await box.cleanup(); }
});

test('A tool turned off and back on for an agent never spreads what was done there meanwhile: a deletion is put back, an edit needs a choice', async () => {
  const box = await sandbox();
  try {
    const claude = join(box.home, '.claude/agents/reviewer.md'), copilot = join(box.home, '.copilot/agents/reviewer.agent.md');
    const on = [{ key: 'reviewer', managed: true, off: [] as HarnessId[] }], off = [{ key: 'reviewer', managed: true, off: ['copilot-cli'] as HarnessId[] }];
    await writeFile(claude, claudeAgent()); await applyAgents(box.context, tools, on);
    await applyAgents(box.context, tools, off); await rm(copilot);
    await applyAgents(box.context, tools, on, { settleMs: 0 });
    assert.equal(await readFile(claude, 'utf8'), claudeAgent());
    assert.match(await readFile(copilot, 'utf8'), /Be brief/, 'put back');
    await applyAgents(box.context, tools, off); await writeFile(copilot, claudeAgent('Copilot only.\n'));
    assert.match(JSON.stringify((await applyAgents(box.context, tools, on)).results), /Choose which copy/);
    assert.equal(await readFile(claude, 'utf8'), claudeAgent());
  } finally { await box.cleanup(); }
});

test('With Sync off, Apply all never spreads a pending agent edit, neither for another agent nor with a tool toggle for this one', async () => {
  const box = await sandbox();
  try {
    const claude = join(box.home, '.claude/agents/reviewer.md');
    await writeFile(claude, claudeAgent()); await applyAgents(box.context, tools, [{ key: 'reviewer', managed: true, off: [] }]);
    await writeFile(join(box.home, '.copilot/agents/reviewer.agent.md'), claudeAgent('Edited in Copilot while Sync is off.\n'));
    assert.equal((await applyAgents(box.context, tools, [], { only: new Set(['other']) })).writes, 0);
    await applyAgents(box.context, tools, [{ key: 'reviewer', managed: true, off: ['codex-cli'] }], { only: new Set(['reviewer']) });
    assert.equal(await readFile(claude, 'utf8'), claudeAgent());
  } finally { await box.cleanup(); }
});

test('A Copilot copy with quoted "name" and "description" keys stays readable after an update', async () => {
  const box = await sandbox();
  try {
    await writeFile(join(box.home, '.claude/agents/reviewer.md'), claudeAgent());
    await writeFile(join(box.home, '.copilot/agents/reviewer.agent.md'), '---\n"name": reviewer\n"description": Reviews code\n---\n\nYou review code.\nBe brief.\n');
    await applyAgents(box.context, tools, [{ key: 'reviewer', managed: true, off: [] }]);
    await writeFile(join(box.home, '.claude/agents/reviewer.md'), claudeAgent('Edited.\n'));
    await applyAgents(box.context, tools, []);
    const copilot = await readAgents(box.context, 'copilot-cli');
    assert.equal(copilot.unreadable.size, 0, copilot.problems.join('; '));
    assert.equal(copilot.entries[0]?.agent.prompt.trim(), 'Edited.');
  } finally { await box.cleanup(); }
});

test('An agent edit whose spread failed at first is still History, so the version it replaced can be restored', async () => {
  const box = await sandbox();
  try {
    await writeFile(join(box.home, '.claude/agents/reviewer.md'), claudeAgent());
    await applyAgents(box.context, tools, [{ key: 'reviewer', managed: true, off: [] }]);
    await writeFile(join(box.home, '.claude/agents/reviewer.md'), claudeAgent('Edited.\n'));
    for (const folder of ['.copilot/agents', '.codex/agents']) await chmod(join(box.home, folder), 0o555);
    await applyAgents(box.context, tools, []);
    for (const folder of ['.copilot/agents', '.codex/agents']) await chmod(join(box.home, folder), 0o755);
    await applyAgents(box.context, tools, []);
    await applyAgents(box.context, tools, []);
    assert.match(await read(box.home, '.copilot/agents/reviewer.agent.md'), /Edited\./);
    const edits = (await readHistory(box.context)).filter(entry => entry.key === 'agent:reviewer' && entry.kind === 'edit');
    assert.equal(edits.length, 1, JSON.stringify(edits));
    assert.notEqual(edits[0].previous, undefined);
  } finally { await box.cleanup(); }
});

test('Apply all records the agent files it adds; Undo removes them while unchanged and unmanages the agent', async () => {
  const box = await sandbox();
  try {
    await writeFile(join(box.home, '.claude/agents/reviewer.md'), claudeAgent());
    await applyAgents(box.context, tools, [{ key: 'reviewer', managed: true, off: [] }]);
    const added = (await readHistory(box.context)).find(event => event.kind === 'added' && event.key === 'agent:reviewer')!;
    assert.deepEqual(added.losers.map(loser => loser.tool).sort(), ['codex-cli', 'copilot-cli']);
    // An edit in Codex since: that file stays, and Codex keeps syncing; Copilot's untouched file goes.
    const codex = join(box.home, '.codex/agents/reviewer.toml');
    await writeFile(codex, (await readFile(codex, 'utf8')).replace('Be brief.', 'Be thorough.'));
    const undone = await restoreAgent(box.context, tools, added.id);
    assert.equal(undone.stopped, undefined);
    assert.deepEqual((await readdir(join(box.home, '.copilot/agents'))), [], 'the untouched added file is gone');
    assert.match(await readFile(codex, 'utf8'), /Be thorough/, 'an edited file stays');
    assert.equal(await read(box.home, '.claude/agents/reviewer.md'), claudeAgent(), 'the original is untouched');
    assert.match((await restoreAgent(box.context, tools, added.id)).stopped ?? '', /already undone/);
  } finally { await box.cleanup(); }
});

test('Undo of an agent Apply all with nothing edited unmanages it', async () => {
  const box = await sandbox();
  try {
    await writeFile(join(box.home, '.claude/agents/reviewer.md'), claudeAgent());
    await applyAgents(box.context, tools, [{ key: 'reviewer', managed: true, off: [] }]);
    const added = (await readHistory(box.context)).find(event => event.kind === 'added')!;
    await restoreAgent(box.context, tools, added.id);
    assert.equal((await agentsView(box.context, tools)).servers.find(server => server.key === 'reviewer')?.managed, false);
    assert.deepEqual(await readdir(join(box.home, '.codex/agents')), []);
  } finally { await box.cleanup(); }
});

test('Convert to skill: an agent becomes a Pi skill once, with its origin recorded; it is never placed back in the agent’s tool', async () => {
  const box = await sandbox();
  try {
    const { convertAgentToSkill } = await import('../src/agents.ts');
    const { manageView, applyChanges } = await import('../src/manage.ts');
    const { discover } = await import('../src/discovery.ts');
    await mkdir(join(box.home, '.pi/agent'), { recursive: true });
    await writeFile(join(box.home, '.claude/agents/reviewer.md'), claudeAgent('You review code.\n', 'model: opus\n'));
    const withPi: HarnessId[] = ['claude-cli', 'pi-cli'];
    const context = { ...box.context, read: () => Promise.all(withPi.map(harness => discover({ home: box.home, mode: 'custom', harness }))) };
    const made = await convertAgentToSkill(context, withPi, 'reviewer');
    assert.equal(made.stopped, undefined);
    const skill = await read(box.home, '.pi/agent/skills/reviewer/SKILL.md');
    assert.match(skill, /^---\nname: "reviewer"\ndescription: "Reviews code"\n---\n\nYou review code\.\n$/);
    assert.match((await convertAgentToSkill(context, withPi, 'reviewer')).stopped ?? '', /already has a skill/);
    await applyChanges({ ...context, settleMs: 0 }, [{ key: 'reviewer', managed: true, off: [] }]);
    const facts = (await manageView(context)).skills.find(item => item.key === 'reviewer')!;
    assert.match(facts.cannot['claude-cli'] ?? '', /Converted from Claude Code’s agent/);
    assert.ok(facts.converted?.losses.some(loss => /model/.test(loss)));
    assert.deepEqual(await readdir(join(box.home, '.claude/skills')).catch(() => []), [], 'nothing reached Claude Code’s skills');
    assert.equal(await read(box.home, '.claude/agents/reviewer.md'), claudeAgent('You review code.\n', 'model: opus\n'), 'the agent is unchanged');
  } finally { await box.cleanup(); }
});

test('Undo of using the source’s copy over a stopped one-way copy puts back only that edit, and it stops again', async () => {
  const box = await sandbox();
  try {
    const source = claudeAgent(undefined, 'tools: Read, Grep\nmodel: opus\n');
    await writeFile(join(box.home, '.claude/agents/reviewer.md'), source);
    await applyAgents(box.context, tools, [{ key: 'reviewer', managed: true, off: [] }]);
    const codex = await read(box.home, '.codex/agents/reviewer.toml');
    const edited = codex.replace('Be brief.', 'Codex only.');
    await writeFile(join(box.home, '.codex/agents/reviewer.toml'), edited);
    await applyAgents(box.context, tools, []);
    assert.deepEqual((await agentsView(box.context, tools)).servers[0].stopped, ['codex-cli']);
    const resumed = await applyAgents(box.context, tools, [{ key: 'reviewer', managed: true, off: [], use: 'claude-cli' }]);
    assert.equal(resumed.writes, 1, JSON.stringify(resumed.results));
    assert.equal(await read(box.home, '.codex/agents/reviewer.toml'), codex);
    const chosen = (await readHistory(box.context)).filter(event => event.kind === 'chosen' && event.key === 'agent:reviewer').at(-1)!;
    assert.deepEqual([chosen.wasSynced, chosen.before?.stopped], [true, ['codex-cli']], 'the stopped copies are named when it is written');
    const copilotBefore = await read(box.home, '.copilot/agents/reviewer.agent.md');
    const undone = await restoreAgent(box.context, tools, chosen.id, 'narrow');
    assert.equal(undone.stopped, undefined, JSON.stringify(undone));
    assert.equal(await read(box.home, '.codex/agents/reviewer.toml'), edited);
    assert.equal(await read(box.home, '.claude/agents/reviewer.md'), source, 'the source is never touched');
    assert.equal(await read(box.home, '.copilot/agents/reviewer.agent.md'), copilotBefore);
    const view = await agentsView(box.context, tools);
    assert.deepEqual(view.servers[0].stopped, ['codex-cli']);
    assert.ok(view.servers[0].limits?.['copilot-cli'], 'still one-way from Claude Code');
    // A later source edit reaches Copilot only, not the restored Codex edit.
    await writeFile(join(box.home, '.claude/agents/reviewer.md'), claudeAgent('Newer.\n', 'tools: Read, Grep\nmodel: opus\n'));
    await applyAgents(box.context, tools, []);
    assert.match(await read(box.home, '.copilot/agents/reviewer.agent.md'), /Newer\./);
    assert.equal(await read(box.home, '.codex/agents/reviewer.toml'), edited);
  } finally { await box.cleanup(); }
});

test('A damaged, unreadable or newer agents record stops every write and is never rewritten; a missing one is a first run', async () => {
  const box = await sandbox();
  try {
    await writeFile(join(box.home, '.claude/agents/reviewer.md'), claudeAgent());
    const first = await applyAgents(box.context, tools, [{ key: 'reviewer', managed: true, off: [] }]);
    assert.equal(first.writes, 2, 'a missing record is a first run');
    const recordFile = join(box.home, '.central-knot/agents.json');
    const good = await read(box.home, '.central-knot/agents.json');
    // An edit in Claude that a pass would spread to Copilot and Codex.
    await writeFile(join(box.home, '.claude/agents/reviewer.md'), claudeAgent('You review code.\nBe thorough.\n'));
    const files = ['.claude/agents/reviewer.md', '.copilot/agents/reviewer.agent.md', '.codex/agents/reviewer.toml'];
    const before = await Promise.all(files.map(file => read(box.home, file)));
    const added = (await readHistory(box.context)).at(-1)!;
    const bad: [string, RegExp][] = [
      ['{"formatVersion": 2, "items": {', /The agents record is damaged\. Nothing was written or deleted/],
      [JSON.stringify({ formatVersion: 2, items: 'none' }), /The agents record is damaged\./],
      [JSON.stringify({ formatVersion: 2, items: { reviewer: { name: 'reviewer', state: 'shared', off: [] } } }), /The agents record is damaged\./],
      [JSON.stringify({ items: {} }), /The agents record is damaged\./],
      [JSON.stringify({ ...JSON.parse(good), formatVersion: 3 }), /The agents record was written by a newer Central Knot\. Nothing was written or deleted/],
    ];
    for (const [text, reason] of bad) {
      await writeFile(recordFile, text);
      assert.match((await applyAgents(box.context, tools, [])).stopped ?? '', reason);
      assert.match((await applyAgents(box.context, tools, [{ key: 'reviewer', managed: false, off: [] }])).stopped ?? '', reason);
      assert.match((await restoreAgent(box.context, tools, added.id)).stopped ?? '', reason);
      const view = await agentsView(box.context, tools);
      assert.deepEqual(view.servers.map(server => server.key), ['reviewer'], 'the page still reads');
      assert.ok(view.gate.state === 'stopped' && reason.test(view.gate.reason));
      assert.ok(view.problems.some(problem => reason.test(problem)));
      assert.equal(await read(box.home, '.central-knot/agents.json'), text, 'the record is left as it is');
      assert.deepEqual(await Promise.all(files.map(file => read(box.home, file))), before, 'no agent file changed');
    }
    await rm(recordFile);
    await mkdir(recordFile);
    assert.match((await applyAgents(box.context, tools, [])).stopped ?? '', /The agents record could not be read\. Nothing was written or deleted/);
    assert.deepEqual(await Promise.all(files.map(file => read(box.home, file))), before);
    await rm(recordFile, { recursive: true });
    await writeFile(recordFile, good);
    const resumed = await applyAgents(box.context, tools, []);
    assert.equal(resumed.stopped, undefined);
    assert.match(await read(box.home, '.copilot/agents/reviewer.agent.md'), /Be thorough\./, 'with the record back, the edit spreads');
  } finally { await box.cleanup(); }
});

test('With an intact record this app has no memory of, Apply stops until an explicit Resume, which keeps the record and remembers it', async () => {
  const box = await sandbox();
  try {
    await writeFile(join(box.home, '.claude/agents/reviewer.md'), claudeAgent());
    await applyAgents(box.context, tools, [{ key: 'reviewer', managed: true, off: [] }]);
    const generation = (await readRecord(box.home)).record!.generation;
    await rm(join(box.base, 'settings.json'));
    await writeFile(join(box.home, '.claude/agents/writer.md'), claudeAgent('You write docs.\n').replace('name: reviewer', 'name: writer'));
    assert.equal((await syncGate(box.context)).state, 'needs-resume');
    const blocked = await applyAgents(box.context, tools, [{ key: 'writer', managed: true, off: [] }]);
    assert.match(blocked.stopped ?? '', /no memory/);
    assert.equal(blocked.writes, 0);
    assert.equal((await syncGate(box.context)).state, 'needs-resume');
    const resumed = await applyAgents(box.context, tools, [{ key: 'writer', managed: true, off: [] }], { resume: true });
    assert.equal(resumed.stopped, undefined);
    assert.equal(resumed.writes, 2, JSON.stringify(resumed.results));
    assert.match(await read(box.home, '.copilot/agents/writer.agent.md'), /You write docs\./);
    assert.equal((await readRecord(box.home)).record!.generation, generation);
    assert.equal((await syncGate(box.context)).state, 'ready');
  } finally { await box.cleanup(); }
});

test('A deletion owed to a tool that was away finishes when it returns, though a stopped one-way copy stays elsewhere', async () => {
  const box = await sandbox();
  try {
    const claude = join(box.home, '.claude/agents/reviewer.md'), copilot = join(box.home, '.copilot/agents/reviewer.agent.md');
    await writeFile(claude, claudeAgent(undefined, 'model: opus\n'));
    await applyAgents(box.context, tools, [{ key: 'reviewer', managed: true, off: [] }]);
    await writeFile(copilot, claudeAgent('Copilot only.\n'));
    await applyAgents(box.context, tools, []);
    await rename(join(box.home, '.codex/agents'), join(box.base, 'codex-away'));
    await rm(claude);
    await applyAgents(box.context, tools, [], { settleMs: 0 });
    await rename(join(box.base, 'codex-away'), join(box.home, '.codex/agents'));
    await applyAgents(box.context, tools, [], { settleMs: 0 });
    assert.deepEqual(await readdir(join(box.home, '.codex/agents')), []);
    assert.equal(await readFile(copilot, 'utf8'), claudeAgent('Copilot only.\n'));
  } finally { await box.cleanup(); }
});

test('A deletion leaves the copy in a tool switched off for the agent, and still finishes in a tool that was away', async () => {
  const box = await sandbox();
  try {
    const claude = join(box.home, '.claude/agents/reviewer.md'), copilot = join(box.home, '.copilot/agents/reviewer.agent.md');
    await writeFile(claude, claudeAgent());
    await applyAgents(box.context, tools, [{ key: 'reviewer', managed: true, off: [] }]);
    await rename(join(box.home, '.codex/agents'), join(box.base, 'codex-away'));
    await rm(claude);
    assert.equal((await applyAgents(box.context, tools, [], { now: 1000, settleMs: 2000 })).settling, true);
    await applyAgents(box.context, tools, [{ key: 'reviewer', managed: true, off: ['copilot-cli'] }], { now: 1500, settleMs: 2000 });
    await applyAgents(box.context, tools, [], { now: 4000, settleMs: 2000 });
    assert.equal(await readFile(copilot, 'utf8'), claudeAgent());
    await rename(join(box.base, 'codex-away'), join(box.home, '.codex/agents'));
    await applyAgents(box.context, tools, [], { now: 5000, settleMs: 2000 });
    assert.deepEqual(await readdir(join(box.home, '.codex/agents')), []);
    assert.equal(await readFile(copilot, 'utf8'), claudeAgent());
  } finally { await box.cleanup(); }
});

test('A deletion first seen before an agent was unmanaged still waits the settle window once it is managed again', async () => {
  const box = await sandbox();
  try {
    const claude = join(box.home, '.claude/agents/reviewer.md');
    await writeFile(claude, claudeAgent());
    await applyAgents(box.context, tools, [{ key: 'reviewer', managed: true, off: [] }]);
    await rm(claude);
    await applyAgents(box.context, tools, [], { now: 1000, settleMs: 2000 });
    await applyAgents(box.context, tools, [{ key: 'reviewer', managed: false, off: [] }], { now: 1100, settleMs: 2000 });
    await writeFile(claude, claudeAgent());
    await applyAgents(box.context, tools, [{ key: 'reviewer', managed: true, off: [] }], { now: 10000, settleMs: 2000 });
    await rm(claude);
    const pass = await applyAgents(box.context, tools, [], { now: 10001, settleMs: 2000 });
    assert.equal(pass.writes, 0, JSON.stringify(pass.results));
    assert.equal(pass.settling, true);
  } finally { await box.cleanup(); }
});

test('A deletion removed from one tool still finishes later in a tool that was away', async () => {
  const box = await sandbox();
  try {
    const claude = join(box.home, '.claude/agents/reviewer.md');
    await writeFile(claude, claudeAgent());
    await applyAgents(box.context, tools, [{ key: 'reviewer', managed: true, off: [] }]);
    await rename(join(box.home, '.codex/agents'), join(box.base, 'codex-away'));
    await rm(claude);
    await applyAgents(box.context, tools, [], { settleMs: 0 });
    assert.deepEqual(await readdir(join(box.home, '.copilot/agents')), []);
    await rename(join(box.base, 'codex-away'), join(box.home, '.codex/agents'));
    await applyAgents(box.context, tools, [], { settleMs: 0 });
    assert.deepEqual(await readdir(join(box.home, '.codex/agents')), []);
  } finally { await box.cleanup(); }
});

test('A deletion leaves the copy in a tool switched off for the agent while its folder was away', async () => {
  const box = await sandbox();
  try {
    const two: HarnessId[] = ['claude-cli', 'codex-cli'], claude = join(box.home, '.claude/agents/reviewer.md');
    await writeFile(claude, claudeAgent());
    await applyAgents(box.context, two, [{ key: 'reviewer', managed: true, off: [] }]);
    await rename(join(box.home, '.codex/agents'), join(box.base, 'codex-away'));
    await applyAgents(box.context, two, [{ key: 'reviewer', managed: true, off: ['codex-cli'] }]);
    await rm(claude);
    await applyAgents(box.context, two, [], { settleMs: 0 });
    await rename(join(box.base, 'codex-away'), join(box.home, '.codex/agents'));
    await applyAgents(box.context, two, [], { settleMs: 0 });
    assert.match(await read(box.home, '.codex/agents/reviewer.toml'), /Be brief/);
  } finally { await box.cleanup(); }
});

test('A copy put back after its tool was switched off and on waits the full settle window when deleted again', async () => {
  const box = await sandbox();
  try {
    const copilot = join(box.home, '.copilot/agents/reviewer.agent.md');
    await writeFile(join(box.home, '.claude/agents/reviewer.md'), claudeAgent());
    await applyAgents(box.context, tools, [{ key: 'reviewer', managed: true, off: [] }]);
    await rm(copilot);
    await applyAgents(box.context, tools, [], { now: 1000, settleMs: 2000 });
    await applyAgents(box.context, tools, [{ key: 'reviewer', managed: true, off: ['copilot-cli'] }], { now: 1500, settleMs: 2000 });
    await applyAgents(box.context, tools, [{ key: 'reviewer', managed: true, off: [] }], { now: 1600, settleMs: 2000 });
    await rm(copilot);
    const pass = await applyAgents(box.context, tools, [], { now: 3500, settleMs: 2000 });
    assert.equal(pass.writes, 0, JSON.stringify(pass.results));
    assert.equal(pass.settling, true);
  } finally { await box.cleanup(); }
});

test('A tool with no agents folder yet gets the agent, as skills and MCP servers do', async () => {
  const box = await sandbox();
  try {
    await rm(join(box.home, '.copilot/agents'), { recursive: true });
    await writeFile(join(box.home, '.claude/agents/reviewer.md'), claudeAgent());
    await applyAgents(box.context, tools, [{ key: 'reviewer', managed: true, off: [] }]);
    assert.match(await read(box.home, '.copilot/agents/reviewer.agent.md'), /Be brief/);
  } finally { await box.cleanup(); }
});

const originShown = async (context: ShareContext) => { const [agent] = (await agentsView(context, tools)).servers; return { oneWay: agent.oneWay, limits: agent.limits, kept: agent.kept }; };

test('An unmanaged agent whose Claude copy differs from Copilot’s shows no origin, as Apply holds for a choice', async () => {
  const box = await sandbox();
  try {
    await writeFile(join(box.home, '.claude/agents/reviewer.md'), claudeAgent(undefined, 'model: opus\n'));
    await writeFile(join(box.home, '.copilot/agents/reviewer.agent.md'), '---\nname: reviewer\ndescription: Copilot reviewer\n---\n\nOther prompt.\n');
    assert.deepEqual(await originShown(box.context), { oneWay: undefined, limits: {}, kept: undefined });
    const held = await applyAgents(box.context, tools, [{ key: 'reviewer', managed: true, off: [] }]);
    assert.equal(held.writes, 0);
    assert.match(held.results[0].message, /Copies differ/);
    assert.deepEqual(await originShown(box.context), { oneWay: undefined, limits: {}, kept: undefined });
  } finally { await box.cleanup(); }
});

test('A richer copy in Copilot doesn’t take over as origin on the page when Apply keeps the recorded Claude origin', async () => {
  const box = await sandbox();
  try {
    await writeFile(join(box.home, '.claude/agents/reviewer.md'), claudeAgent(undefined, 'model: opus\n'));
    await applyAgents(box.context, tools, [{ key: 'reviewer', managed: true, off: [] }]);
    await applyAgents(box.context, tools, [{ key: 'reviewer', managed: false, off: [] }]);
    const copilot = join(box.home, '.copilot/agents/reviewer.agent.md');
    await writeFile(copilot, (await readFile(copilot, 'utf8')).replace('description: Reviews code\n', 'description: Reviews code\nmodel: gpt-6\ntools: [read]\n'));
    const before = await originShown(box.context);
    assert.deepEqual(before.oneWay, { from: 'claude-cli', lost: ['model'] });
    assert.match(before.limits?.['copilot-cli'] ?? '', /^One-way from Claude Code\./);
    const result = await applyAgents(box.context, tools, [{ key: 'reviewer', managed: true, off: [] }]);
    assert.equal(result.writes, 0, JSON.stringify(result.results));
    assert.deepEqual(await originShown(box.context), before);
  } finally { await box.cleanup(); }
});

test('A click is told the History entries it made: On, and Sync here written to a tool synced again; Undo takes that copy back out and leaves the tool out; a stale page is refused', async () => {
  const box = await sandbox();
  try {
    await writeFile(join(box.home, '.claude/agents/reviewer.md'), claudeAgent());
    const kinds = async (ids?: string[]) => { const history = await readHistory(box.context); return (ids ?? []).map(id => history.find(event => event.id === id)?.kind); };
    const on = await applyAgents(box.context, tools, [{ key: 'reviewer', managed: true, off: [], seenManaged: false }]);
    assert.deepEqual(await kinds(on.made), ['added']);
    // Codex left out, its file taken out by hand; Sync here writes it again, as a copy its Undo takes back out.
    await applyAgents(box.context, tools, [{ key: 'reviewer', managed: true, off: ['codex-cli'], seenManaged: true }]);
    await rm(join(box.home, '.codex/agents/reviewer.toml'));
    const again = await applyAgents(box.context, tools, [{ key: 'reviewer', managed: true, off: [], seenManaged: true }]);
    const added = (await readHistory(box.context)).find(event => event.id === again.made?.[0]);
    assert.deepEqual([added?.kind, added?.rejoined, added?.losers.map(loser => loser.tool)], ['added', true, ['codex-cli']]);
    assert.equal((await restoreAgent(box.context, tools, added!.id)).stopped, undefined);
    assert.deepEqual(await readdir(join(box.home, '.codex/agents')), []);
    const after = (await agentsView(box.context, tools)).servers[0];
    assert.deepEqual([after.managed, after.off], [true, ['codex-cli']], 'still synced, Codex left out again');
    assert.equal((await applyAgents(box.context, tools, [])).writes, 0);
    const stale = await applyAgents(box.context, tools, [{ key: 'reviewer', managed: false, off: [], seenManaged: false }]);
    assert.match(stale.results[0]?.message ?? '', /changed since the page was read/);
    assert.equal(stale.results[0]?.unchanged, true, 'said as a refusal that changed nothing');
    assert.equal((await agentsView(box.context, tools)).servers[0].managed, true);
  } finally { await box.cleanup(); }
});

test('Undo of a copy choice for a two-way agent puts the replaced copy back in its own tool and takes the added one out; it is not synced again', async () => {
  const box = await sandbox();
  try {
    await writeFile(join(box.home, '.claude/agents/reviewer.md'), claudeAgent());
    const other = '---\nname: reviewer\ndescription: Copilot reviewer\n---\n\nOther prompt.\n';
    await writeFile(join(box.home, '.copilot/agents/reviewer.agent.md'), other);
    const chose = await applyAgents(box.context, tools, [{ key: 'reviewer', managed: true, off: [], seenManaged: false, use: 'claude-cli' }]);
    const history = await readHistory(box.context);
    assert.deepEqual(chose.made?.map(id => history.find(event => event.id === id)?.kind), ['added', 'chosen']);
    const chosen = history.find(event => chose.made?.includes(event.id) && event.kind === 'chosen')!;
    const undone = await restoreAgent(box.context, tools, chosen.id, 'narrow');
    assert.equal(undone.stopped, undefined, JSON.stringify(undone));
    assert.equal(await read(box.home, '.copilot/agents/reviewer.agent.md'), other, 'Copilot has its own copy back');
    assert.equal(await read(box.home, '.claude/agents/reviewer.md'), claudeAgent());
    assert.deepEqual(await readdir(join(box.home, '.codex/agents')), [], 'the added Codex copy is gone');
    assert.equal((await agentsView(box.context, tools)).servers[0].managed, false);
    assert.equal((await applyAgents(box.context, tools, [])).writes, 0);
  } finally { await box.cleanup(); }
});

test('Undo of a copy choice whose pass added nothing, after an earlier On, takes out no copy: only the replaced one goes back', async () => {
  const box = await sandbox();
  try {
    // On: Copilot CLI and Codex get copies (an 'added' entry). Off stops syncing; the copies stay. Copilot CLI's is edited.
    await writeFile(join(box.home, '.claude/agents/reviewer.md'), claudeAgent());
    await applyAgents(box.context, tools, [{ key: 'reviewer', managed: true, off: [] }]);
    await applyAgents(box.context, tools, [{ key: 'reviewer', managed: false, off: [], seenManaged: true }]);
    const codex = await read(box.home, '.codex/agents/reviewer.toml');
    const edited = (await read(box.home, '.copilot/agents/reviewer.agent.md')).replace('Be brief.', 'Copilot’s own.');
    await writeFile(join(box.home, '.copilot/agents/reviewer.agent.md'), edited);
    // On again, choosing Claude Code's copy: Copilot CLI's is replaced, nothing is added.
    const chose = await applyAgents(box.context, tools, [{ key: 'reviewer', managed: true, off: [], seenManaged: false, use: 'claude-cli' }]);
    const chosen = (await readHistory(box.context)).find(event => chose.made?.includes(event.id) && event.kind === 'chosen')!;
    assert.deepEqual([chose.made?.length, chosen.addedId, chosen.wasSynced], [1, undefined, undefined]);
    // A copy changed since stops the Undo before anything is written.
    const copilotNow = await read(box.home, '.copilot/agents/reviewer.agent.md');
    await writeFile(join(box.home, '.copilot/agents/reviewer.agent.md'), copilotNow.replace('Be brief.', 'Changed since.'));
    assert.match((await restoreAgent(box.context, tools, chosen.id, 'narrow')).stopped ?? '', /changed since, so nothing was undone/);
    await writeFile(join(box.home, '.copilot/agents/reviewer.agent.md'), copilotNow);
    const undone = await restoreAgent(box.context, tools, chosen.id, 'narrow');
    assert.equal(undone.stopped, undefined, JSON.stringify(undone));
    assert.deepEqual([await read(box.home, '.copilot/agents/reviewer.agent.md'), await read(box.home, '.codex/agents/reviewer.toml')], [edited, codex], 'Copilot’s edit back; Codex’s copy, from the earlier On, stays');
    assert.ok((await readHistory(box.context)).find(event => event.id === chosen.id)?.undoneBy);
    assert.equal((await agentsView(box.context, tools)).servers[0].managed, false);
  } finally { await box.cleanup(); }
});

test('Undo of a copy choice on a synced agent puts it back as before the choice: Codex’s own copy waits for a choice again', async () => {
  const box = await sandbox();
  try {
    await writeFile(join(box.home, '.claude/agents/reviewer.md'), claudeAgent());
    await applyAgents(box.context, tools, [{ key: 'reviewer', managed: true, off: [] }]);
    // Codex left out, edited there, then synced to again: its copy differs, so it waits for a choice.
    await applyAgents(box.context, tools, [{ key: 'reviewer', managed: true, off: ['codex-cli'], seenManaged: true }]);
    const edited = (await read(box.home, '.codex/agents/reviewer.toml')).replace('Be brief.', 'Codex’s own.');
    await writeFile(join(box.home, '.codex/agents/reviewer.toml'), edited);
    await applyAgents(box.context, tools, [{ key: 'reviewer', managed: true, off: [], seenManaged: true }]);
    const chose = await applyAgents(box.context, tools, [{ key: 'reviewer', managed: true, off: [], seenManaged: true, use: 'claude-cli' }]);
    const chosen = (await readHistory(box.context)).find(event => chose.made?.includes(event.id) && event.kind === 'chosen')!;
    assert.deepEqual([chosen.wasSynced, chosen.addedId, chosen.losers.map(loser => loser.tool)], [true, undefined, ['codex-cli']]);
    const copilot = await read(box.home, '.copilot/agents/reviewer.agent.md');
    const undone = await restoreAgent(box.context, tools, chosen.id, 'narrow');
    assert.equal(undone.stopped, undefined, JSON.stringify(undone));
    assert.deepEqual(undone.results.map(entry => [entry.harness, entry.outcome]), [['codex-cli', 'written']]);
    const after = (await agentsView(box.context, tools)).servers[0];
    assert.deepEqual([await read(box.home, '.codex/agents/reviewer.toml'), await read(box.home, '.copilot/agents/reviewer.agent.md'), after.managed, after.off], [edited, copilot, true, []]);
    for (const pass of [1, 2]) {
      const next = await applyAgents(box.context, tools, []);
      assert.deepEqual([next.writes, next.results.some(entry => entry.differs)], [0, true], `pass ${pass}: Codex’s copy is neither caught up over nor spread`);
    }
  } finally { await box.cleanup(); }
});

test('Undo of choosing a left-out tool’s own agent copy puts the synced copies back on record: an edit after it is one edit, not a conflict', async () => {
  const box = await sandbox();
  try {
    await writeFile(join(box.home, '.claude/agents/reviewer.md'), claudeAgent());
    await applyAgents(box.context, tools, [{ key: 'reviewer', managed: true, off: [] }]);
    await applyAgents(box.context, tools, [{ key: 'reviewer', managed: true, off: ['codex-cli'], seenManaged: true }]);
    const codex = (await read(box.home, '.codex/agents/reviewer.toml')).replace('Be brief.', 'Codex’s own.');
    await writeFile(join(box.home, '.codex/agents/reviewer.toml'), codex);
    await applyAgents(box.context, tools, [{ key: 'reviewer', managed: true, off: [], seenManaged: true }]);
    const chose = await applyAgents(box.context, tools, [{ key: 'reviewer', managed: true, off: [], seenManaged: true, use: 'codex-cli' }]);
    const chosen = (await readHistory(box.context)).find(event => chose.made?.includes(event.id) && event.kind === 'chosen')!;
    assert.equal((await restoreAgent(box.context, tools, chosen.id, 'narrow')).stopped, undefined);
    assert.equal(await read(box.home, '.claude/agents/reviewer.md'), claudeAgent());
    // An edit in Claude Code, then Codex out again, as before Sync here: the edit reaches Copilot CLI as an edit.
    await writeFile(join(box.home, '.claude/agents/reviewer.md'), claudeAgent('Edited in Claude.\n'));
    const edit = await applyAgents(box.context, tools, [{ key: 'reviewer', managed: true, off: ['codex-cli'], seenManaged: true }]);
    assert.deepEqual(edit.notices?.map(notice => notice.kind), ['edit'], JSON.stringify(edit.notices));
    assert.match(await read(box.home, '.copilot/agents/reviewer.agent.md'), /Edited in Claude\./);
    assert.equal(await read(box.home, '.codex/agents/reviewer.toml'), codex);
  } finally { await box.cleanup(); }
});

test('Undo of a choice that also synced to a left-out tool again takes that copy out and leaves the tool out again', async () => {
  const box = await sandbox();
  try {
    await writeFile(join(box.home, '.claude/agents/reviewer.md'), claudeAgent());
    await applyAgents(box.context, tools, [{ key: 'reviewer', managed: true, off: [] }]);
    // Copilot CLI and Codex left out; Copilot CLI's copy edited, Codex's removed.
    await applyAgents(box.context, tools, [{ key: 'reviewer', managed: true, off: ['copilot-cli', 'codex-cli'], seenManaged: true }]);
    const copilot = (await read(box.home, '.copilot/agents/reviewer.agent.md')).replace('Be brief.', 'Copilot’s own.');
    await writeFile(join(box.home, '.copilot/agents/reviewer.agent.md'), copilot);
    await rm(join(box.home, '.codex/agents/reviewer.toml'));
    // On everywhere with Claude Code's copy: Copilot CLI's is replaced, Codex is given one again.
    const chose = await applyAgents(box.context, tools, [{ key: 'reviewer', managed: true, off: [], seenManaged: true, use: 'claude-cli' }]);
    const chosen = (await readHistory(box.context)).find(event => chose.made?.includes(event.id) && event.kind === 'chosen')!;
    assert.ok(chosen.addedId);
    assert.equal((await restoreAgent(box.context, tools, chosen.id, 'narrow')).stopped, undefined);
    const after = (await agentsView(box.context, tools)).servers[0];
    assert.deepEqual([await read(box.home, '.copilot/agents/reviewer.agent.md'), await readdir(join(box.home, '.codex/agents')), after.off.includes('codex-cli')], [copilot, [], true]);
  } finally { await box.cleanup(); }
});

test('An agent choice’s Undo that can’t put a copy back or take an added one out stops part-way, and History’s Undo finishes it on an agent no longer synced', async () => {
  const box = await sandbox();
  try {
    await writeFile(join(box.home, '.claude/agents/reviewer.md'), claudeAgent());
    const other = '---\nname: reviewer\ndescription: Copilot reviewer\n---\n\nOther prompt.\n';
    await writeFile(join(box.home, '.copilot/agents/reviewer.agent.md'), other);
    const chose = await applyAgents(box.context, tools, [{ key: 'reviewer', managed: true, off: [], seenManaged: false, use: 'claude-cli' }]);
    const chosen = (await readHistory(box.context)).find(event => chose.made?.includes(event.id) && event.kind === 'chosen')!;
    assert.ok(chosen.addedId, 'Codex’s copy came with the choice');
    for (const folder of ['.copilot/agents', '.codex/agents']) await chmod(join(box.home, folder), 0o555);
    const once = await restoreAgent(box.context, tools, chosen.id, 'narrow');
    for (const folder of ['.copilot/agents', '.codex/agents']) await chmod(join(box.home, folder), 0o755);
    assert.deepEqual(once.results.map(entry => [entry.harness, entry.outcome]).sort(), [['codex-cli', 'failed'], ['copilot-cli', 'failed']]);
    assert.match(once.results.find(entry => entry.harness === 'copilot-cli')!.message, /EACCES|permission/i, 'the real reason is said');
    assert.equal((await agentsView(box.context, tools)).servers[0].managed, false);
    const finished = await restoreAgent(box.context, tools, chosen.id, 'narrow');
    assert.equal(finished.stopped, undefined, JSON.stringify(finished));
    assert.deepEqual([await read(box.home, '.copilot/agents/reviewer.agent.md'), await readdir(join(box.home, '.codex/agents'))], [other, []]);
    assert.ok((await readHistory(box.context)).filter(event => [chosen.id, chosen.addedId].includes(event.id)).every(event => event.undoneBy));
  } finally { await box.cleanup(); }
});

test('A choice on a synced agent whose source has Claude-only fields is no resume: its Undo puts Codex’s edit back waiting for a choice, not stopped', async () => {
  const box = await sandbox();
  try {
    const fields = 'tools: Read, Grep\nmodel: opus\n';
    await writeFile(join(box.home, '.claude/agents/reviewer.md'), claudeAgent(undefined, fields));
    await applyAgents(box.context, tools, [{ key: 'reviewer', managed: true, off: [] }]);
    await applyAgents(box.context, tools, [{ key: 'reviewer', managed: true, off: ['codex-cli'], seenManaged: true }]);
    const edited = (await read(box.home, '.codex/agents/reviewer.toml')).replace('Be brief.', 'Codex’s own.');
    await writeFile(join(box.home, '.codex/agents/reviewer.toml'), edited);
    await applyAgents(box.context, tools, [{ key: 'reviewer', managed: true, off: [], seenManaged: true }]);
    const chose = await applyAgents(box.context, tools, [{ key: 'reviewer', managed: true, off: [], seenManaged: true, use: 'claude-cli' }]);
    const chosen = (await readHistory(box.context)).find(event => chose.made?.includes(event.id) && event.kind === 'chosen')!;
    assert.deepEqual([chosen.wasSynced, chosen.before?.stopped], [true, undefined], 'no copy had stopped: no resume');
    assert.equal((await restoreAgent(box.context, tools, chosen.id, 'narrow')).stopped, undefined);
    const after = (await agentsView(box.context, tools)).servers[0];
    assert.deepEqual([await read(box.home, '.codex/agents/reviewer.toml'), after.stopped ?? [], after.off], [edited, [], []]);
    const next = await applyAgents(box.context, tools, []);
    assert.deepEqual([next.writes, next.results.some(entry => entry.differs)], [0, true]);
  } finally { await box.cleanup(); }
});

test('Undo of a copy choice whose chosen copy has Claude Code only fields is the same narrow Undo: no stopped copy is made up', async () => {
  const box = await sandbox();
  try {
    await writeFile(join(box.home, '.claude/agents/reviewer.md'), claudeAgent(undefined, 'tools: Read, Grep\nmodel: opus\n'));
    const other = '---\nname: reviewer\ndescription: Copilot reviewer\n---\n\nOther prompt.\n';
    await writeFile(join(box.home, '.copilot/agents/reviewer.agent.md'), other);
    const chose = await applyAgents(box.context, tools, [{ key: 'reviewer', managed: true, off: [], seenManaged: false, use: 'claude-cli' }]);
    const chosen = (await readHistory(box.context)).find(event => chose.made?.includes(event.id) && event.kind === 'chosen')!;
    assert.ok(chosen.addedId, 'Codex’s copy came with the choice');
    const undone = await restoreAgent(box.context, tools, chosen.id, 'narrow');
    assert.equal(undone.stopped, undefined, JSON.stringify(undone));
    assert.equal(await read(box.home, '.copilot/agents/reviewer.agent.md'), other);
    assert.deepEqual(await readdir(join(box.home, '.codex/agents')), [], 'the copy the choice added is gone');
    const after = (await agentsView(box.context, tools)).servers[0];
    assert.deepEqual([after.managed, after.stopped ?? []], [false, []]);
  } finally { await box.cleanup(); }
});

test('Undo of putting a deleted agent back leaves a copy changed since as it is', async () => {
  const box = await sandbox();
  try {
    await writeFile(join(box.home, '.claude/agents/reviewer.md'), claudeAgent());
    await applyAgents(box.context, tools, [{ key: 'reviewer', managed: true, off: [] }]);
    await rm(join(box.home, '.copilot/agents/reviewer.agent.md'));
    const deleted = await applyAgents(box.context, tools, [], { settleMs: 0 });
    const back = await restoreAgent(box.context, tools, deleted.notices![0].history);
    const codex = (await read(box.home, '.codex/agents/reviewer.toml')).replace('Be brief.', 'Edited since.');
    await writeFile(join(box.home, '.codex/agents/reviewer.toml'), codex);
    const again = await restoreAgent(box.context, tools, back.made![0]);
    assert.deepEqual(again.results.map(entry => [entry.harness, entry.outcome]).sort(), [['claude-cli', 'removed'], ['codex-cli', 'held'], ['copilot-cli', 'removed']]);
    assert.equal(await read(box.home, '.codex/agents/reviewer.toml'), codex);
  } finally { await box.cleanup(); }
});

test('Undo of putting a deleted agent back is the deletion again; it stays on offer, off, with no copy left', async () => {
  const box = await sandbox();
  try {
    await writeFile(join(box.home, '.claude/agents/reviewer.md'), claudeAgent());
    await applyAgents(box.context, tools, [{ key: 'reviewer', managed: true, off: [] }]);
    await rm(join(box.home, '.copilot/agents/reviewer.agent.md'));
    const deleted = await applyAgents(box.context, tools, [], { settleMs: 0 });
    assert.deepEqual(((await agentsView(box.context, tools)).gone ?? []).map(agent => [agent.key, agent.gone?.history]), [['reviewer', deleted.notices![0].history]]);
    const back = await restoreAgent(box.context, tools, deleted.notices![0].history);
    assert.deepEqual([back.stopped, back.made?.length], [undefined, 1]);
    const again = await restoreAgent(box.context, tools, back.made![0]);
    assert.equal(again.stopped, undefined, JSON.stringify(again));
    for (const folder of ['.claude/agents', '.copilot/agents', '.codex/agents']) assert.deepEqual(await readdir(join(box.home, folder)), []);
    assert.deepEqual(((await agentsView(box.context, tools)).gone ?? []).map(agent => [agent.key, agent.gone?.history]), [['reviewer', again.made![0]]]);
  } finally { await box.cleanup(); }
});

test('Undo of putting a deleted agent back leaves a stopped copy as its tool’s own', async () => {
  const box = await sandbox();
  try {
    await writeFile(join(box.home, '.claude/agents/reviewer.md'), claudeAgent(undefined, 'tools: Read, Grep\nmodel: opus\n'));
    await applyAgents(box.context, tools, [{ key: 'reviewer', managed: true, off: [] }]);
    const edited = (await read(box.home, '.codex/agents/reviewer.toml')).replace('Be brief.', 'Codex only.');
    await writeFile(join(box.home, '.codex/agents/reviewer.toml'), edited);
    await applyAgents(box.context, tools, []);
    // Deleted at its source: the deletion spreads, and Codex's stopped copy stays.
    await rm(join(box.home, '.claude/agents/reviewer.md'));
    const deleted = await applyAgents(box.context, tools, [], { settleMs: 0 });
    const back = await restoreAgent(box.context, tools, deleted.notices![0].history);
    assert.equal(back.stopped, undefined, JSON.stringify(back));
    const again = await restoreAgent(box.context, tools, back.made![0]);
    assert.equal(again.stopped, undefined);
    assert.equal(await read(box.home, '.codex/agents/reviewer.toml'), edited, 'the stopped copy stays, with its edit');
    assert.deepEqual(again.results.filter(entry => entry.harness === 'codex-cli'), [], 'as its tool’s own, not as one “changed since”');
  } finally { await box.cleanup(); }
});

test('Off then On keeps a stopped one-way copy as it was: still stopped with its edit, nothing to choose, nothing written', async () => {
  const box = await sandbox();
  try {
    await writeFile(join(box.home, '.claude/agents/reviewer.md'), claudeAgent(undefined, 'tools: Read, Grep\nmodel: opus\n'));
    await applyAgents(box.context, tools, [{ key: 'reviewer', managed: true, off: [] }]);
    const edited = (await read(box.home, '.codex/agents/reviewer.toml')).replace('Be brief.', 'Codex only.');
    await writeFile(join(box.home, '.codex/agents/reviewer.toml'), edited);
    await applyAgents(box.context, tools, []);
    assert.deepEqual((await agentsView(box.context, tools)).servers[0].stopped, ['codex-cli']);
    await applyAgents(box.context, tools, [{ key: 'reviewer', managed: false, off: [], seenManaged: true }]);
    const on = await applyAgents(box.context, tools, [{ key: 'reviewer', managed: true, off: [], seenManaged: false }]);
    assert.equal(on.writes, 0, JSON.stringify(on.results));
    assert.ok(!on.results.some(entry => entry.differs), 'no choice asked for');
    const view = (await agentsView(box.context, tools)).servers[0];
    assert.deepEqual([view.managed, view.stopped], [true, ['codex-cli']]);
    assert.equal(await read(box.home, '.codex/agents/reviewer.toml'), edited);
  } finally { await box.cleanup(); }
});

const fields = 'tools: Read, Grep\nmodel: opus\n';
/**
 * An agent's record with its copies in tool order, to compare one moment with another. A stopped copy's hash and bytes are left
 * out: nothing reads them while it is stopped (the pass that stops it keeps the last synced ones, an Undo records its edit).
 */
const recordOf = async (home: string) => {
  const item = (await readAgentRecord(home)).items.reviewer;
  return { ...item, copies: [...item.copies].sort((first, second) => first.tool.localeCompare(second.tool)).map(copy => (copy.stopped ? { ...copy, hash: '', bytes: '' } : copy)) };
};
const chosenOf = async (box: { context: ShareContext }, made?: string[]) => (await readHistory(box.context)).find(event => made?.includes(event.id) && event.kind === 'chosen')!;
const codexOwn = 'name = "reviewer"\ndescription = "Reviews code"\ndeveloper_instructions = """\nCodex’s own reviewer.\n"""\n';

test('Undo of a choice of a non-source copy puts the source and its one-way copies back: an edit in a receiving tool then stops there, as without the choice (probes O2, O0)', async () => {
  for (const undone of [true, false]) {
    const box = await sandbox();
    try {
      const source = claudeAgent(undefined, fields);
      await writeFile(join(box.home, '.claude/agents/reviewer.md'), source);
      await applyAgents(box.context, ['claude-cli', 'copilot-cli'], [{ key: 'reviewer', managed: true, off: [] }]);
      await writeFile(join(box.home, '.codex/agents/reviewer.toml'), codexOwn);
      assert.ok((await applyAgents(box.context, tools, [])).results.some(entry => entry.differs));
      const before = await recordOf(box.home);
      if (undone) {
        const chose = await applyAgents(box.context, tools, [{ key: 'reviewer', managed: true, off: [], seenManaged: true, use: 'codex-cli' }]);
        assert.equal((await restoreAgent(box.context, tools, (await chosenOf(box, chose.made)).id, 'narrow')).stopped, undefined);
        assert.deepEqual(await recordOf(box.home), before, 'the record is as before the choice: source and one-way marks too');
      }
      // While the choice still waits, Copilot CLI's copy is edited; then Codex is left out.
      const copilot = (await read(box.home, '.copilot/agents/reviewer.agent.md')).replace('Be brief.', 'Copilot’s own.');
      await writeFile(join(box.home, '.copilot/agents/reviewer.agent.md'), copilot);
      const left = await applyAgents(box.context, tools, [{ key: 'reviewer', managed: true, off: ['codex-cli'], seenManaged: true }]);
      assert.equal(left.writes, 0, `${undone ? 'O2' : 'O0'}: ${JSON.stringify(left.results)}`);
      assert.equal(await read(box.home, '.claude/agents/reviewer.md'), source, 'Claude Code’s prompt is never overwritten');
      assert.deepEqual((await agentsView(box.context, tools)).servers[0].stopped, ['copilot-cli']);
      // The next plain pass and the next click (Sync here on Codex) write nothing.
      assert.equal((await applyAgents(box.context, tools, [])).writes, 0);
      const rejoin = await applyAgents(box.context, tools, [{ key: 'reviewer', managed: true, off: [], seenManaged: true }]);
      assert.deepEqual([rejoin.writes, rejoin.results.some(entry => entry.differs)], [0, true]);
      assert.equal(await read(box.home, '.codex/agents/reviewer.toml'), codexOwn);
    } finally { await box.cleanup(); }
  }
});

test('A choice of identical copies takes the one with the most fields as the source, whichever tool the card named: Codex’s copy is then one-way (probe G1)', async () => {
  const box = await sandbox();
  try {
    const source = claudeAgent(undefined, fields);
    await writeFile(join(box.home, '.claude/agents/reviewer.md'), source);
    await writeFile(join(box.home, '.copilot/agents/reviewer.agent.md'), claudeAgent());
    await writeFile(join(box.home, '.codex/agents/reviewer.toml'), codexOwn);
    // The shared card "Copilot CLI and Claude Code’s copy (the same)" sends Copilot CLI.
    await applyAgents(box.context, tools, [{ key: 'reviewer', managed: true, off: [], seenManaged: false, use: 'copilot-cli' }]);
    const view = (await agentsView(box.context, tools)).servers[0];
    assert.equal(view.oneWay?.from, 'claude-cli');
    assert.ok(view.limits?.['codex-cli'] && view.limits?.['copilot-cli']);
    // An edit in Codex stops there; nothing spreads over Claude Code's prompt, on this pass or the next.
    await writeFile(join(box.home, '.codex/agents/reviewer.toml'), (await read(box.home, '.codex/agents/reviewer.toml')).replace('Be brief.', 'Codex edit.'));
    for (const pass of [1, 2]) assert.equal((await applyAgents(box.context, tools, [])).writes, 0, `pass ${pass}`);
    assert.equal(await read(box.home, '.claude/agents/reviewer.md'), source);
    assert.deepEqual((await agentsView(box.context, tools)).servers[0].stopped, ['codex-cli']);
  } finally { await box.cleanup(); }
});

test('Undo of a choice that also replaced a stopped copy records it stopped again: leaving the other tool out again holds nothing (probes MIX, S3)', async () => {
  const box = await sandbox();
  try {
    await writeFile(join(box.home, '.claude/agents/reviewer.md'), claudeAgent(undefined, fields));
    await applyAgents(box.context, tools, [{ key: 'reviewer', managed: true, off: [] }]);
    const codex = (await read(box.home, '.codex/agents/reviewer.toml')).replace('Be brief.', 'Codex only.');
    await writeFile(join(box.home, '.codex/agents/reviewer.toml'), codex);
    await applyAgents(box.context, tools, []);
    // Copilot CLI left out, edited there, and taken back in: its copy differs, so it waits for a choice.
    await applyAgents(box.context, tools, [{ key: 'reviewer', managed: true, off: ['copilot-cli'], seenManaged: true }]);
    const copilot = (await read(box.home, '.copilot/agents/reviewer.agent.md')).replace('Be brief.', 'Copilot’s own.');
    await writeFile(join(box.home, '.copilot/agents/reviewer.agent.md'), copilot);
    assert.ok((await applyAgents(box.context, tools, [{ key: 'reviewer', managed: true, off: [], seenManaged: true }])).results.some(entry => entry.differs));
    const before = await recordOf(box.home);
    const chose = await applyAgents(box.context, tools, [{ key: 'reviewer', managed: true, off: [], seenManaged: true, use: 'claude-cli' }]);
    const chosen = await chosenOf(box, chose.made);
    assert.deepEqual(chosen.losers.map(loser => loser.tool).sort(), ['codex-cli', 'copilot-cli'], 'an ordinary choice, no resume');
    assert.equal((await restoreAgent(box.context, tools, chosen.id, 'narrow')).stopped, undefined);
    assert.deepEqual([await read(box.home, '.codex/agents/reviewer.toml'), await read(box.home, '.copilot/agents/reviewer.agent.md')], [codex, copilot]);
    assert.deepEqual(await recordOf(box.home), before, 'the record is as before the choice');
    assert.deepEqual((await agentsView(box.context, tools)).servers[0].stopped, ['codex-cli']);
    const plain = await applyAgents(box.context, tools, []);
    assert.deepEqual([plain.writes, plain.results.some(entry => entry.differs)], [0, true], 'Copilot CLI’s copy waits for a choice again');
    const left = await applyAgents(box.context, tools, [{ key: 'reviewer', managed: true, off: ['copilot-cli'], seenManaged: true }]);
    assert.deepEqual([left.writes, left.results.some(entry => entry.differs)], [0, false], 'Codex quietly keeps its edit');
  } finally { await box.cleanup(); }
});

test('One stopped copy given the source’s copy again leaves every other stopped copy as it is; its Undo puts that edit back, stopped (probes R2, D1)', async () => {
  const box = await sandbox();
  try {
    await writeFile(join(box.home, '.claude/agents/reviewer.md'), claudeAgent(undefined, fields));
    await applyAgents(box.context, tools, [{ key: 'reviewer', managed: true, off: [] }]);
    const codexSynced = await read(box.home, '.codex/agents/reviewer.toml');
    const copilot = (await read(box.home, '.copilot/agents/reviewer.agent.md')).replace('Be brief.', 'Copilot’s own.');
    const codex = codexSynced.replace('Be brief.', 'Codex only.');
    await writeFile(join(box.home, '.copilot/agents/reviewer.agent.md'), copilot);
    await writeFile(join(box.home, '.codex/agents/reviewer.toml'), codex);
    await applyAgents(box.context, tools, []);
    assert.deepEqual((await agentsView(box.context, tools)).servers[0].stopped, ['copilot-cli', 'codex-cli']);
    const before = await recordOf(box.home);
    // Codex's Stopped switch: only Codex gets Claude Code's copy.
    const resumed = await applyAgents(box.context, tools, [{ key: 'reviewer', managed: true, off: [], seenManaged: true, use: 'claude-cli', resumeIn: 'codex-cli' }]);
    assert.equal(resumed.writes, 1, JSON.stringify(resumed.results));
    assert.deepEqual([await read(box.home, '.codex/agents/reviewer.toml'), await read(box.home, '.copilot/agents/reviewer.agent.md')], [codexSynced, copilot]);
    assert.deepEqual((await agentsView(box.context, tools)).servers[0].stopped, ['copilot-cli']);
    assert.equal((await applyAgents(box.context, tools, [])).writes, 0);
    const undone = await restoreAgent(box.context, tools, (await chosenOf(box, resumed.made)).id, 'narrow');
    assert.equal(undone.stopped, undefined, JSON.stringify(undone));
    assert.deepEqual([await read(box.home, '.codex/agents/reviewer.toml'), await read(box.home, '.copilot/agents/reviewer.agent.md')], [codex, copilot]);
    assert.deepEqual(await recordOf(box.home), before);
    assert.equal((await applyAgents(box.context, tools, [])).writes, 0);
  } finally { await box.cleanup(); }
});

test('Finish undo of a choice leaves an agent turned off since off: only the copy still to go back goes back (probe F1)', { skip: process.getuid?.() === 0 }, async () => {
  const box = await sandbox();
  try {
    await writeFile(join(box.home, '.claude/agents/reviewer.md'), claudeAgent());
    await applyAgents(box.context, tools, [{ key: 'reviewer', managed: true, off: [] }]);
    await applyAgents(box.context, tools, [{ key: 'reviewer', managed: true, off: ['codex-cli'], seenManaged: true }]);
    const codex = (await read(box.home, '.codex/agents/reviewer.toml')).replace('Be brief.', 'Codex’s own.');
    await writeFile(join(box.home, '.codex/agents/reviewer.toml'), codex);
    await applyAgents(box.context, tools, [{ key: 'reviewer', managed: true, off: [], seenManaged: true }]);
    const chose = await applyAgents(box.context, tools, [{ key: 'reviewer', managed: true, off: [], seenManaged: true, use: 'claude-cli' }]);
    const chosen = await chosenOf(box, chose.made);
    await chmod(join(box.home, '.codex/agents'), 0o555);
    const once = await restoreAgent(box.context, tools, chosen.id, 'narrow');
    await chmod(join(box.home, '.codex/agents'), 0o755);
    assert.deepEqual(once.results.map(entry => [entry.harness, entry.outcome]), [['codex-cli', 'failed']]);
    await applyAgents(box.context, tools, [{ key: 'reviewer', managed: false, off: [], seenManaged: true }]);
    const finished = await restoreAgent(box.context, tools, chosen.id, 'narrow');
    assert.equal(finished.stopped, undefined, JSON.stringify(finished));
    assert.equal(await read(box.home, '.codex/agents/reviewer.toml'), codex);
    assert.equal((await agentsView(box.context, tools)).servers[0].managed, false, 'still off');
    assert.equal((await applyAgents(box.context, tools, [])).writes, 0);
  } finally { await box.cleanup(); }
});

test('Undo of an On whose pass added a copy keeps a stopped copy on record: On again asks nothing and leaves its edit', async () => {
  const box = await sandbox();
  try {
    await writeFile(join(box.home, '.claude/agents/reviewer.md'), claudeAgent(undefined, fields));
    await applyAgents(box.context, tools, [{ key: 'reviewer', managed: true, off: [] }]);
    const codex = (await read(box.home, '.codex/agents/reviewer.toml')).replace('Be brief.', 'Codex only.');
    await writeFile(join(box.home, '.codex/agents/reviewer.toml'), codex);
    await applyAgents(box.context, tools, []);
    // Off, then Copilot CLI's copy goes: On adds it again, as an 'added' entry.
    await applyAgents(box.context, tools, [{ key: 'reviewer', managed: false, off: [], seenManaged: true }]);
    await rm(join(box.home, '.copilot/agents/reviewer.agent.md'));
    const on = await applyAgents(box.context, tools, [{ key: 'reviewer', managed: true, off: [], seenManaged: false }]);
    const added = (await readHistory(box.context)).find(event => on.made?.includes(event.id) && event.kind === 'added')!;
    assert.equal((await restoreAgent(box.context, tools, added.id)).stopped, undefined);
    const again = await applyAgents(box.context, tools, [{ key: 'reviewer', managed: true, off: [], seenManaged: false }]);
    assert.ok(!again.results.some(entry => entry.differs), JSON.stringify(again.results));
    assert.deepEqual([(await agentsView(box.context, tools)).servers[0].stopped, await read(box.home, '.codex/agents/reviewer.toml')], [['codex-cli'], codex]);
  } finally { await box.cleanup(); }
});

test('Undo of a choice stops on a copy changed since in a field outside the content (the bytes on record differ): that edit stays', async () => {
  const box = await sandbox();
  try {
    await writeFile(join(box.home, '.claude/agents/reviewer.md'), claudeAgent());
    const other = '---\nname: reviewer\ndescription: Copilot reviewer\n---\n\nOther prompt.\n';
    await writeFile(join(box.home, '.copilot/agents/reviewer.agent.md'), other);
    const chose = await applyAgents(box.context, tools, [{ key: 'reviewer', managed: true, off: [], seenManaged: false, use: 'claude-cli' }]);
    const copilot = (await read(box.home, '.copilot/agents/reviewer.agent.md')).replace('description: Reviews code\n', 'description: Reviews code\nmodel: my-model\n');
    await writeFile(join(box.home, '.copilot/agents/reviewer.agent.md'), copilot);
    assert.match((await restoreAgent(box.context, tools, (await chosenOf(box, chose.made)).id, 'narrow')).stopped ?? '', /changed since, so nothing was undone/);
    assert.equal(await read(box.home, '.copilot/agents/reviewer.agent.md'), copilot);
  } finally { await box.cleanup(); }
});

test('Undo of a choice leaves a copy that stopped updating after it (a later pass) stopped, its edit kept', async () => {
  const box = await sandbox();
  try {
    await writeFile(join(box.home, '.claude/agents/reviewer.md'), claudeAgent(undefined, fields));
    await applyAgents(box.context, tools, [{ key: 'reviewer', managed: true, off: [] }]);
    await applyAgents(box.context, tools, [{ key: 'reviewer', managed: true, off: ['copilot-cli'], seenManaged: true }]);
    await writeFile(join(box.home, '.copilot/agents/reviewer.agent.md'), (await read(box.home, '.copilot/agents/reviewer.agent.md')).replace('Be brief.', 'Copilot’s own.'));
    await applyAgents(box.context, tools, [{ key: 'reviewer', managed: true, off: [], seenManaged: true }]);
    // Claude Code's copy chosen: Copilot CLI's is replaced, Codex already held it. Then Codex's copy is edited and a pass stops it.
    const chose = await applyAgents(box.context, tools, [{ key: 'reviewer', managed: true, off: [], seenManaged: true, use: 'claude-cli' }]);
    const chosen = await chosenOf(box, chose.made);
    assert.deepEqual(chosen.losers.map(loser => loser.tool), ['copilot-cli']);
    const codex = (await read(box.home, '.codex/agents/reviewer.toml')).replace('Be brief.', 'Codex only.');
    await writeFile(join(box.home, '.codex/agents/reviewer.toml'), codex);
    await applyAgents(box.context, tools, []);
    assert.equal((await restoreAgent(box.context, tools, chosen.id, 'narrow')).stopped, undefined);
    assert.deepEqual([(await agentsView(box.context, tools)).servers[0].stopped, await read(box.home, '.codex/agents/reviewer.toml')], [['codex-cli'], codex]);
    const left = await applyAgents(box.context, tools, [{ key: 'reviewer', managed: true, off: ['copilot-cli'], seenManaged: true }]);
    assert.deepEqual([left.writes, left.results.some(entry => entry.differs)], [0, false]);
  } finally { await box.cleanup(); }
});

/** The agent's record as it is, its copies in tool order, nothing left out: for an Undo whose end state must match a full one exactly. */
const fullRecordOf = async (home: string) => { const item = (await readAgentRecord(home)).items.reviewer; return { ...item, copies: [...item.copies].sort((first, second) => first.tool.localeCompare(second.tool)) }; };
const sha = (text: string) => createHash('sha256').update(text).digest('hex');
/** Codex stopped (its edit), Copilot CLI left out, edited there and taken back in, so it waits for a choice (probes MIX, PW). */
async function stoppedAndWaiting(box: Awaited<ReturnType<typeof sandbox>>) {
  await writeFile(join(box.home, '.claude/agents/reviewer.md'), claudeAgent(undefined, fields));
  await applyAgents(box.context, tools, [{ key: 'reviewer', managed: true, off: [] }]);
  const codex = (await read(box.home, '.codex/agents/reviewer.toml')).replace('Be brief.', 'Codex only.');
  await writeFile(join(box.home, '.codex/agents/reviewer.toml'), codex);
  await applyAgents(box.context, tools, []);
  await applyAgents(box.context, tools, [{ key: 'reviewer', managed: true, off: ['copilot-cli'], seenManaged: true }]);
  const copilot = (await read(box.home, '.copilot/agents/reviewer.agent.md')).replace('Be brief.', 'Copilot’s own.');
  await writeFile(join(box.home, '.copilot/agents/reviewer.agent.md'), copilot);
  assert.ok((await applyAgents(box.context, tools, [{ key: 'reviewer', managed: true, off: [], seenManaged: true }])).results.some(entry => entry.differs));
  return { codex, copilot };
}

test('Finish undo of a choice whose first Undo put a stopped copy back finishes: the record is as before it, and the other copy waits for a choice again (probe PW2)', { skip: process.getuid?.() === 0 }, async () => {
  const box = await sandbox();
  try {
    const { codex, copilot } = await stoppedAndWaiting(box);
    const before = await recordOf(box.home);
    const chose = await applyAgents(box.context, tools, [{ key: 'reviewer', managed: true, off: [], seenManaged: true, use: 'claude-cli' }]);
    const chosen = await chosenOf(box, chose.made);
    await chmod(join(box.home, '.copilot/agents'), 0o555);
    const once = await restoreAgent(box.context, tools, chosen.id, 'narrow');
    await chmod(join(box.home, '.copilot/agents'), 0o755);
    assert.deepEqual(once.results.map(entry => [entry.harness, entry.outcome]).sort(), [['codex-cli', 'written'], ['copilot-cli', 'failed']]);
    assert.equal((await applyAgents(box.context, tools, [])).writes, 0);
    const finished = await restoreAgent(box.context, tools, chosen.id, 'narrow');
    assert.equal(finished.stopped, undefined, JSON.stringify(finished));
    assert.ok((await readHistory(box.context)).find(event => event.id === chosen.id)?.undoneBy, 'the entry is done');
    assert.deepEqual([await read(box.home, '.codex/agents/reviewer.toml'), await read(box.home, '.copilot/agents/reviewer.agent.md')], [codex, copilot]);
    assert.deepEqual(await recordOf(box.home), before);
    // The copy put back stopped is on record as the file it is now.
    assert.equal((await readAgentRecord(box.home)).items.reviewer.copies.find(copy => copy.tool === 'codex-cli')?.bytes, sha(codex));
    assert.deepEqual((await agentsView(box.context, tools)).servers[0].stopped, ['codex-cli']);
    const plain = await applyAgents(box.context, tools, []);
    assert.deepEqual([plain.writes, plain.results.some(entry => entry.differs)], [0, true], 'Copilot CLI’s copy waits for a choice, not stopped');
  } finally { await box.cleanup(); }
});

test('An Undo that couldn’t put a stopped copy back yet leaves that copy receiving until Finish undo puts its edit back, stopped (probe PW)', { skip: process.getuid?.() === 0 }, async () => {
  const box = await sandbox();
  try {
    const { codex } = await stoppedAndWaiting(box);
    const before = await recordOf(box.home);
    const chose = await applyAgents(box.context, tools, [{ key: 'reviewer', managed: true, off: [], seenManaged: true, use: 'claude-cli' }]);
    const chosen = await chosenOf(box, chose.made);
    await chmod(join(box.home, '.codex/agents'), 0o555);
    const once = await restoreAgent(box.context, tools, chosen.id, 'narrow');
    await chmod(join(box.home, '.codex/agents'), 0o755);
    assert.deepEqual(once.results.map(entry => [entry.harness, entry.outcome]).sort(), [['codex-cli', 'failed'], ['copilot-cli', 'written']]);
    // Codex still holds Claude Code's copy: not marked stopped, so it still receives.
    assert.deepEqual((await agentsView(box.context, tools)).servers[0].stopped, []);
    assert.equal((await readAgentRecord(box.home)).items.reviewer.copies.find(copy => copy.tool === 'codex-cli')?.stopped, undefined);
    assert.equal((await applyAgents(box.context, tools, [])).writes, 0);
    assert.equal((await restoreAgent(box.context, tools, chosen.id, 'narrow')).stopped, undefined);
    assert.equal(await read(box.home, '.codex/agents/reviewer.toml'), codex);
    assert.deepEqual(await recordOf(box.home), before);
    assert.deepEqual((await agentsView(box.context, tools)).servers[0].stopped, ['codex-cli']);
  } finally { await box.cleanup(); }
});

test('Undo of a choice puts back the source the agent had, not the copy with the most fields: an edit at the source then spreads, as without the choice (probes P1, P0)', async () => {
  for (const undone of [true, false]) {
    const box = await sandbox();
    try {
      // Made in Copilot CLI and synced to Claude Code, two-way; Claude Code's copy then gets a field of its own (same content).
      await writeFile(join(box.home, '.copilot/agents/reviewer.agent.md'), claudeAgent());
      await applyAgents(box.context, ['claude-cli', 'copilot-cli'], [{ key: 'reviewer', managed: true, off: [] }]);
      await writeFile(join(box.home, '.claude/agents/reviewer.md'), claudeAgent(undefined, 'model: opus\n'));
      assert.equal((await applyAgents(box.context, ['claude-cli', 'copilot-cli'], [])).writes, 0);
      await writeFile(join(box.home, '.codex/agents/reviewer.toml'), codexOwn);
      assert.ok((await applyAgents(box.context, tools, [])).results.some(entry => entry.differs));
      const before = await fullRecordOf(box.home);
      assert.equal(before.origin, 'copilot-cli');
      if (undone) {
        const chose = await applyAgents(box.context, tools, [{ key: 'reviewer', managed: true, off: [], seenManaged: true, use: 'codex-cli' }]);
        assert.equal((await restoreAgent(box.context, tools, (await chosenOf(box, chose.made)).id, 'narrow')).stopped, undefined);
        assert.deepEqual(await fullRecordOf(box.home), before, 'the record is as before the choice: its source too');
      }
      await writeFile(join(box.home, '.copilot/agents/reviewer.agent.md'), claudeAgent('You review code.\nCopilot’s own.\n'));
      const left = await applyAgents(box.context, tools, [{ key: 'reviewer', managed: true, off: ['codex-cli'], seenManaged: true }]);
      assert.deepEqual(left.notices?.map(notice => [notice.kind, notice.winner]), [['edit', 'copilot-cli']], `${undone ? 'P1' : 'P0'}: ${JSON.stringify(left.results)}`);
      assert.match(await read(box.home, '.claude/agents/reviewer.md'), /model: opus\n[\s\S]*Copilot’s own\./);
    } finally { await box.cleanup(); }
  }
});

test('An agent turned off and turned on again with a choice takes the fullest copy as its source, not the source it had before', async () => {
  const box = await sandbox();
  try {
    // Made in Copilot CLI and synced to Claude Code, then turned off; Claude Code's copy then gets a field of its own (same content).
    await writeFile(join(box.home, '.copilot/agents/reviewer.agent.md'), claudeAgent());
    await applyAgents(box.context, ['claude-cli', 'copilot-cli'], [{ key: 'reviewer', managed: true, off: [] }]);
    await applyAgents(box.context, ['claude-cli', 'copilot-cli'], [{ key: 'reviewer', managed: false, off: [], seenManaged: true }]);
    assert.equal((await readAgentRecord(box.home)).items.reviewer.origin, 'copilot-cli', 'turned off, the record still names its old source');
    await writeFile(join(box.home, '.claude/agents/reviewer.md'), claudeAgent(undefined, 'model: opus\n'));
    await writeFile(join(box.home, '.codex/agents/reviewer.toml'), codexOwn);
    // On again with the card Copilot CLI and Claude Code share, which names Copilot CLI.
    await applyAgents(box.context, tools, [{ key: 'reviewer', managed: true, off: [], seenManaged: false, use: 'copilot-cli' }]);
    assert.equal((await readAgentRecord(box.home)).items.reviewer.origin, 'claude-cli');
    assert.equal((await agentsView(box.context, tools)).servers[0].oneWay?.from, 'claude-cli');
  } finally { await box.cleanup(); }
});

test('Using Claude Code’s copy keeps Claude Code the source when a stopped copy with the same content has more fields: its next edit spreads, and Undo is as before (probes G1c, R4)', async () => {
  const box = await sandbox();
  try {
    await writeFile(join(box.home, '.claude/agents/reviewer.md'), claudeAgent(undefined, fields));
    await applyAgents(box.context, tools, [{ key: 'reviewer', managed: true, off: [] }]);
    // Copilot CLI's copy gets three fields of its own (same content), so it stops; Codex leaves and comes back with its own copy.
    const copilot = (await read(box.home, '.copilot/agents/reviewer.agent.md')).replace('description: Reviews code\n', 'description: Reviews code\nmodel: my-model\ntarget: vscode\nfoo: bar\n');
    await writeFile(join(box.home, '.copilot/agents/reviewer.agent.md'), copilot);
    await applyAgents(box.context, tools, []);
    await applyAgents(box.context, tools, [{ key: 'reviewer', managed: true, off: ['codex-cli'], seenManaged: true }]);
    await writeFile(join(box.home, '.codex/agents/reviewer.toml'), codexOwn);
    assert.ok((await applyAgents(box.context, tools, [{ key: 'reviewer', managed: true, off: [], seenManaged: true }])).results.some(entry => entry.differs));
    const before = await recordOf(box.home);
    const chose = await applyAgents(box.context, tools, [{ key: 'reviewer', managed: true, off: [], seenManaged: true, use: 'claude-cli' }]);
    assert.deepEqual([(await readAgentRecord(box.home)).items.reviewer.origin, (await agentsView(box.context, tools)).servers[0].oneWay?.from], ['claude-cli', 'claude-cli']);
    assert.equal((await restoreAgent(box.context, tools, (await chosenOf(box, chose.made)).id, 'narrow')).stopped, undefined);
    assert.deepEqual(await recordOf(box.home), before);
    // Chosen again, then edited in Claude Code: the edit spreads to every copy (each choice gives them all Claude Code's), and
    // Copilot CLI's keeps its own fields.
    await applyAgents(box.context, tools, [{ key: 'reviewer', managed: true, off: [], seenManaged: true, use: 'claude-cli' }]);
    await writeFile(join(box.home, '.claude/agents/reviewer.md'), claudeAgent('You review code.\nSource edit.\n', fields));
    const edit = await applyAgents(box.context, tools, []);
    assert.deepEqual(edit.notices?.map(notice => [notice.kind, notice.winner, notice.losers]), [['edit', 'claude-cli', ['copilot-cli', 'codex-cli']]], JSON.stringify(edit.results));
    assert.equal(await read(box.home, '.copilot/agents/reviewer.agent.md'), copilot.replace('Be brief.', 'Source edit.'));
  } finally { await box.cleanup(); }
});

test('A choice of the same content in two copies with as many fields keeps the named one the source; a copy in a tool left out is never the source', async () => {
  for (const [use, off, origin] of [['claude-cli', [], 'claude-cli'], ['copilot-cli', [], 'copilot-cli'], ['copilot-cli', ['claude-cli'], 'copilot-cli']] as [HarnessId, HarnessId[], HarnessId][]) {
    const box = await sandbox();
    try {
      // Claude Code's copy has one field of its own and Copilot CLI's another; in the last case Claude Code's has more and is left out.
      await writeFile(join(box.home, '.claude/agents/reviewer.md'), claudeAgent(undefined, off.length ? fields : 'model: opus\n'));
      await writeFile(join(box.home, '.copilot/agents/reviewer.agent.md'), claudeAgent(undefined, 'target: vscode\n'));
      await writeFile(join(box.home, '.codex/agents/reviewer.toml'), codexOwn);
      await applyAgents(box.context, tools, [{ key: 'reviewer', managed: true, off, seenManaged: false, use }]);
      assert.equal((await readAgentRecord(box.home)).items.reviewer.origin, origin, `${use} chosen, ${off.join(', ') || 'none'} left out`);
    } finally { await box.cleanup(); }
  }
});

test('The Stopped switch gives only its tool the source’s copy: another copy’s edit no pass has seen yet stops there, before and after the Undo (probe R5)', async () => {
  const box = await sandbox();
  try {
    await writeFile(join(box.home, '.claude/agents/reviewer.md'), claudeAgent(undefined, fields));
    await applyAgents(box.context, tools, [{ key: 'reviewer', managed: true, off: [] }]);
    const codex = (await read(box.home, '.codex/agents/reviewer.toml')).replace('Be brief.', 'Codex only.');
    await writeFile(join(box.home, '.codex/agents/reviewer.toml'), codex);
    await applyAgents(box.context, tools, []);
    // Automatic sync off: Copilot CLI's copy is edited and no pass runs before Codex's Stopped switch is clicked.
    const copilot = (await read(box.home, '.copilot/agents/reviewer.agent.md')).replace('Be brief.', 'Copilot’s own.');
    await writeFile(join(box.home, '.copilot/agents/reviewer.agent.md'), copilot);
    const only = new Set(['reviewer']);
    const resumed = await applyAgents(box.context, tools, [{ key: 'reviewer', managed: true, off: [], seenManaged: true, use: 'claude-cli', resumeIn: 'codex-cli' }], { only });
    const chosen = await chosenOf(box, resumed.made);
    assert.deepEqual([resumed.writes, chosen.losers.map(loser => loser.tool)], [1, ['codex-cli']], JSON.stringify(resumed.results));
    assert.equal(await read(box.home, '.copilot/agents/reviewer.agent.md'), copilot);
    assert.deepEqual((await agentsView(box.context, tools)).servers[0].stopped, ['copilot-cli']);
    assert.equal((await restoreAgent(box.context, tools, chosen.id, 'narrow')).stopped, undefined);
    assert.deepEqual([await read(box.home, '.codex/agents/reviewer.toml'), await read(box.home, '.copilot/agents/reviewer.agent.md')], [codex, copilot]);
    assert.deepEqual((await agentsView(box.context, tools)).servers[0].stopped, ['copilot-cli', 'codex-cli']);
    const plain = await applyAgents(box.context, tools, []);
    assert.deepEqual([plain.writes, plain.results.some(entry => entry.differs)], [0, false]);
  } finally { await box.cleanup(); }
});

test('History’s Undo of a Stopped switch puts back only that tool’s edit, stopped: the edit doesn’t spread to the other tools', async () => {
  const box = await sandbox();
  try {
    await writeFile(join(box.home, '.claude/agents/reviewer.md'), claudeAgent(undefined, fields));
    await applyAgents(box.context, tools, [{ key: 'reviewer', managed: true, off: [] }]);
    const synced = await read(box.home, '.copilot/agents/reviewer.agent.md');
    const codex = (await read(box.home, '.codex/agents/reviewer.toml')).replace('Be brief.', 'Codex only.');
    await writeFile(join(box.home, '.codex/agents/reviewer.toml'), codex);
    await applyAgents(box.context, tools, []);
    const before = await recordOf(box.home);
    const resumed = await applyAgents(box.context, tools, [{ key: 'reviewer', managed: true, off: [], seenManaged: true, use: 'claude-cli', resumeIn: 'codex-cli' }]);
    // History's Undo sends no 'narrow': a Stopped switch is undone in its own tool all the same.
    assert.equal((await restoreAgent(box.context, tools, (await chosenOf(box, resumed.made)).id)).stopped, undefined);
    assert.deepEqual([await read(box.home, '.codex/agents/reviewer.toml'), await read(box.home, '.copilot/agents/reviewer.agent.md')], [codex, synced]);
    assert.deepEqual(await recordOf(box.home), before);
  } finally { await box.cleanup(); }
});

test('Finish undo leaves a copy put back holding the synced content on record with its one-way mark, as a full Undo does: its later edit stops there (probe O2F)', { skip: process.getuid?.() === 0 }, async () => {
  const box = await sandbox();
  try {
    await writeFile(join(box.home, '.claude/agents/reviewer.md'), claudeAgent(undefined, fields));
    await applyAgents(box.context, ['claude-cli', 'copilot-cli'], [{ key: 'reviewer', managed: true, off: [] }]);
    await writeFile(join(box.home, '.codex/agents/reviewer.toml'), codexOwn);
    await applyAgents(box.context, tools, []);
    const before = await fullRecordOf(box.home);
    const chose = await applyAgents(box.context, tools, [{ key: 'reviewer', managed: true, off: [], seenManaged: true, use: 'codex-cli' }]);
    const chosen = await chosenOf(box, chose.made);
    await chmod(join(box.home, '.copilot/agents'), 0o555);
    await restoreAgent(box.context, tools, chosen.id, 'narrow');
    await chmod(join(box.home, '.copilot/agents'), 0o755);
    assert.ok((await applyAgents(box.context, tools, [])).results.some(entry => entry.differs));
    assert.equal((await restoreAgent(box.context, tools, chosen.id, 'narrow')).stopped, undefined);
    assert.deepEqual(await fullRecordOf(box.home), before);
    await writeFile(join(box.home, '.copilot/agents/reviewer.agent.md'), (await read(box.home, '.copilot/agents/reviewer.agent.md')).replace('Be brief.', 'Copilot’s own.'));
    const left = await applyAgents(box.context, tools, [{ key: 'reviewer', managed: true, off: ['codex-cli'], seenManaged: true }]);
    assert.deepEqual([left.writes, left.results.some(entry => entry.differs)], [0, false], JSON.stringify(left.results));
    assert.deepEqual((await agentsView(box.context, tools)).servers[0].stopped, ['copilot-cli']);
  } finally { await box.cleanup(); }
});

test('Undo of a choice gives the copy it puts back its earlier edit time, so the copy edited most recently is the same one as before', async () => {
  const box = await sandbox();
  try {
    await writeFile(join(box.home, '.claude/agents/reviewer.md'), claudeAgent());
    await writeFile(join(box.home, '.codex/agents/reviewer.toml'), codexOwn);
    const earlier = new Date(Date.now() - 3_600_000);
    await utimes(join(box.home, '.claude/agents/reviewer.md'), earlier, earlier);
    const times = async () => Object.fromEntries(Object.entries((await agentsView(box.context, tools)).servers[0].copies).map(([tool, copy]) => [tool, copy!.modified]));
    const before = await times();
    // Codex's newer copy is chosen, then undone: Claude Code's older copy is written back.
    const chose = await applyAgents(box.context, tools, [{ key: 'reviewer', managed: true, off: [], seenManaged: false, use: 'codex-cli' }]);
    assert.equal((await restoreAgent(box.context, tools, (await chosenOf(box, chose.made)).id, 'narrow')).stopped, undefined);
    const after = await times();
    assert.equal(after['claude-cli'], before['claude-cli']);
    assert.ok(Date.parse(after['codex-cli']!) > Date.parse(after['claude-cli']!), 'Codex’s is still the one edited most recently');
  } finally { await box.cleanup(); }
});

test('Choosing the content a synced agent’s source holds keeps that source, whichever card names it, though another copy has more fields', async () => {
  for (const use of ['claude-cli', 'copilot-cli'] as const) {
    const box = await sandbox();
    try {
      // Two-way from Copilot CLI; Claude Code's copy has a field of its own (same content); Codex turns up with its own copy.
      await writeFile(join(box.home, '.copilot/agents/reviewer.agent.md'), claudeAgent());
      await applyAgents(box.context, ['claude-cli', 'copilot-cli'], [{ key: 'reviewer', managed: true, off: [] }]);
      await writeFile(join(box.home, '.claude/agents/reviewer.md'), claudeAgent(undefined, 'model: opus\n'));
      await writeFile(join(box.home, '.codex/agents/reviewer.toml'), codexOwn);
      await applyAgents(box.context, tools, []);
      await applyAgents(box.context, tools, [{ key: 'reviewer', managed: true, off: [], seenManaged: true, use }]);
      assert.equal((await readAgentRecord(box.home)).items.reviewer.origin, 'copilot-cli', `the card named ${use}`);
    } finally { await box.cleanup(); }
  }
});

test('An Undo stopped part-way with the source not back yet never makes a stopped copy the source, and a stopped copy stays one-way; Finish undo is as before', { skip: process.getuid?.() === 0 }, async () => {
  for (const stoppedIn of ['copilot-cli', 'codex-cli'] as const) {
    const box = await sandbox();
    try {
      await writeFile(join(box.home, '.claude/agents/reviewer.md'), claudeAgent(undefined, fields));
      await applyAgents(box.context, tools, [{ key: 'reviewer', managed: true, off: [] }]);
      if (stoppedIn === 'copilot-cli') {
        // Copilot CLI stops on three fields of its own (same content); Codex leaves, is edited and comes back, waiting for a choice.
        await writeFile(join(box.home, '.copilot/agents/reviewer.agent.md'), (await read(box.home, '.copilot/agents/reviewer.agent.md')).replace('description: Reviews code\n', 'description: Reviews code\nmodel: my-model\ntarget: vscode\nfoo: bar\n'));
        await applyAgents(box.context, tools, []);
        await applyAgents(box.context, tools, [{ key: 'reviewer', managed: true, off: ['codex-cli'], seenManaged: true }]);
        await writeFile(join(box.home, '.codex/agents/reviewer.toml'), codexOwn);
        await applyAgents(box.context, tools, [{ key: 'reviewer', managed: true, off: [], seenManaged: true }]);
      } else {
        await writeFile(join(box.home, '.codex/agents/reviewer.toml'), (await read(box.home, '.codex/agents/reviewer.toml')).replace('Be brief.', 'Codex only.'));
        await applyAgents(box.context, tools, []);
      }
      const before = await recordOf(box.home);
      // Codex's copy chosen; Claude Code's (the source) can't go back at first.
      const chose = await applyAgents(box.context, tools, [{ key: 'reviewer', managed: true, off: [], seenManaged: true, use: 'codex-cli' }]);
      const chosen = await chosenOf(box, chose.made);
      await chmod(join(box.home, '.claude/agents'), 0o555);
      await restoreAgent(box.context, tools, chosen.id, 'narrow');
      await chmod(join(box.home, '.claude/agents'), 0o755);
      const between = (await readAgentRecord(box.home)).items.reviewer;
      assert.ok(!between.copies.some(copy => copy.stopped && copy.tool === between.origin), `${stoppedIn}: a stopped copy is never the source`);
      assert.ok(between.copies.filter(copy => copy.stopped).every(copy => copy.oneWay), `${stoppedIn}: a stopped copy stays one-way`);
      assert.equal((await restoreAgent(box.context, tools, chosen.id, 'narrow')).stopped, undefined);
      assert.deepEqual(await recordOf(box.home), before);
    } finally { await box.cleanup(); }
  }
});

test('Finish undo after the synced content moved on leaves it where it is: the source stays on record with it, and the next pass writes nothing', { skip: process.getuid?.() === 0 }, async () => {
  const box = await sandbox();
  try {
    await stoppedAndWaiting(box);
    const chose = await applyAgents(box.context, tools, [{ key: 'reviewer', managed: true, off: [], seenManaged: true, use: 'claude-cli' }]);
    const chosen = await chosenOf(box, chose.made);
    await chmod(join(box.home, '.codex/agents'), 0o555);
    await restoreAgent(box.context, tools, chosen.id, 'narrow');
    await chmod(join(box.home, '.codex/agents'), 0o755);
    // Copilot CLI left out, then an edit in Claude Code spreads (to Codex, which still receives).
    await writeFile(join(box.home, '.claude/agents/reviewer.md'), claudeAgent('You review code.\nSource v2.\n', fields));
    await applyAgents(box.context, tools, [{ key: 'reviewer', managed: true, off: ['copilot-cli'], seenManaged: true }]);
    const moved = (await readAgentRecord(box.home)).items.reviewer.hash;
    assert.equal((await restoreAgent(box.context, tools, chosen.id, 'narrow')).stopped, undefined);
    const after = (await readAgentRecord(box.home)).items.reviewer;
    assert.deepEqual([after.hash, after.origin, after.copies.find(copy => copy.tool === 'claude-cli')?.hash], [moved, 'claude-cli', moved]);
    assert.equal((await applyAgents(box.context, tools, [])).writes, 0);
  } finally { await box.cleanup(); }
});

test('A choice never makes a copy that had stopped updating the source, nor one in a tool the same change leaves out, though either has more fields', async () => {
  for (const flow of ['on again', 'source left out'] as const) {
    const box = await sandbox();
    try {
      await writeFile(join(box.home, '.claude/agents/reviewer.md'), claudeAgent(undefined, `${fields}color: blue\n`));
      await applyAgents(box.context, tools, [{ key: 'reviewer', managed: true, off: [] }]);
      if (flow === 'on again') {
        // Copilot CLI stops on four fields of its own (same content); the agent is turned off, Codex edited, and it is turned on
        // again choosing Claude Code's copy.
        await writeFile(join(box.home, '.copilot/agents/reviewer.agent.md'), (await read(box.home, '.copilot/agents/reviewer.agent.md')).replace('description: Reviews code\n', 'description: Reviews code\nmodel: my-model\ntarget: vscode\nfoo: bar\nbaz: 1\n'));
        await applyAgents(box.context, tools, []);
        await applyAgents(box.context, tools, [{ key: 'reviewer', managed: false, off: [], seenManaged: true }]);
        await writeFile(join(box.home, '.codex/agents/reviewer.toml'), codexOwn);
        await applyAgents(box.context, tools, [{ key: 'reviewer', managed: true, off: [], seenManaged: false, use: 'claude-cli' }]);
        assert.equal((await readAgentRecord(box.home)).items.reviewer.origin, 'claude-cli', flow);
      } else {
        // Codex stops on two settings of its own (same content); Copilot CLI's copy is chosen with Claude Code, the source, left out.
        await writeFile(join(box.home, '.codex/agents/reviewer.toml'), `model = "gpt"\nsandbox_mode = "read-only"\n${await read(box.home, '.codex/agents/reviewer.toml')}`);
        await applyAgents(box.context, tools, []);
        await applyAgents(box.context, tools, [{ key: 'reviewer', managed: true, off: ['claude-cli'], seenManaged: true, use: 'copilot-cli' }]);
        assert.equal((await readAgentRecord(box.home)).items.reviewer.origin, 'copilot-cli', flow);
      }
    } finally { await box.cleanup(); }
  }
});
