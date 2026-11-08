import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { agentText, agentsView, applyAgents, readAgents, restoreAgent } from '../src/agents.ts';
import { readHistory } from '../src/manage.ts';
import type { ShareContext } from '../src/share.ts';
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
    assert.match(view.servers[0].limits?.['copilot-cli'] ?? '', /With limits: no equivalent here for tools, model from Claude Code/);
    assert.match(view.servers[0].limits?.['codex-cli'] ?? '', /one-way/);
    assert.equal(view.servers[0].limits?.['claude-cli'], undefined);
    await applyAgents(box.context, tools, [{ key: 'reviewer', managed: true, off: [] }]);
    const copilot = await read(box.home, '.copilot/agents/reviewer.agent.md');
    assert.ok(!copilot.includes('tools:') && !copilot.includes('model:'), 'no invented equivalent');
    // Edit in Copilot (one-way): stays there, Claude untouched, Copilot no longer updated.
    await writeFile(join(box.home, '.copilot/agents/reviewer.agent.md'), copilot.replace('Be brief.', 'Copilot only.'));
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
    assert.match(await read(box.home, '.copilot/agents/reviewer.agent.md'), /Copilot only\./);
    // Deleting the one-way Codex copy deletes nothing elsewhere.
    await rm(join(box.home, '.codex/agents/reviewer.toml'));
    await applyAgents(box.context, tools, [], { settleMs: 0 });
    assert.match(await read(box.home, '.claude/agents/reviewer.md'), /New prompt\./);
  } finally { await box.cleanup(); }
});

test('Updating a copy keeps that tool’s own fields, comments and tables', async () => {
  const box = await sandbox();
  try {
    const codex = `# my agent\nname = "reviewer"\ndescription = "Reviews code"\nmodel = "gpt-6"\ndeveloper_instructions = """\nYou review code.\nBe brief.\n"""\n\n[mcp_servers.docs]\nurl = "https://example.com/mcp"\n`;
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
    const claude = `---\n# keep me\nname: reviewer\ndescription: Reviews code\n---\n\nSay "hi" with a \\ and """quotes"""\ttab.\n`;
    assert.equal(agentText('claude-cli', { name: 'reviewer', description: 'Reviews code', prompt: 'x' }, claude), '---\n# keep me\nname: reviewer\ndescription: Reviews code\n---\n\nx');
  } finally { await box.cleanup(); }
});

test('A different agent with the same name needs a choice; a chosen copy replaces the other and is kept in History', async () => {
  const box = await sandbox();
  try {
    await writeFile(join(box.home, '.claude/agents/reviewer.md'), claudeAgent());
    await writeFile(join(box.home, '.copilot/agents/reviewer.agent.md'), '---\nname: reviewer\ndescription: Copilot reviewer\n---\n\nOther prompt.\n');
    const held = await applyAgents(box.context, tools, [{ key: 'reviewer', managed: true, off: [] }]);
    assert.equal(held.writes, 0);
    assert.match(held.results[0].message, /Choose which copy/);
    const chosen = await applyAgents(box.context, tools, [{ key: 'reviewer', managed: true, off: [], use: 'claude-cli' }]);
    assert.equal(chosen.writes, 2, JSON.stringify(chosen.results));
    assert.match(await read(box.home, '.copilot/agents/reviewer.agent.md'), /Reviews code/);
  } finally { await box.cleanup(); }
});

test('Deleting a two-way copy deletes everywhere after it settles; Restore brings it back; a missing tool folder is not a deletion', async () => {
  const box = await sandbox();
  try {
    await writeFile(join(box.home, '.claude/agents/reviewer.md'), claudeAgent());
    await applyAgents(box.context, tools, [{ key: 'reviewer', managed: true, off: [] }]);
    // The whole Codex agents folder goes away: nothing is deleted anywhere, and Codex's copy is put back.
    await rm(join(box.home, '.codex/agents'), { recursive: true });
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
    const event = (await readHistory(box.home)).find(entry => entry.kind === 'deleted' && entry.key === 'agent:reviewer');
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
    const view = await agentsView(box.context, tools);
    assert.deepEqual(view.servers.map(server => server.key), ['reviewer']);
    assert.equal(view.problems.length, 2);
    assert.equal((await applyAgents(box.context, tools, [])).writes, 0);
    assert.deepEqual(await readdir(join(box.home, '.copilot/agents')), []);
  } finally { await box.cleanup(); }
});
