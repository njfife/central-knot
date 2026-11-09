import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { applyMcp, mcpView } from '../src/mcp.ts';
import type { ShareContext } from '../src/share.ts';
import type { HarnessId } from '../src/types.ts';

const tools: HarnessId[] = ['claude-cli', 'copilot-cli', 'codex-cli'];
async function sandbox() {
  const base = await realpath(await mkdtemp(join(tmpdir(), 'ck-mcp-')));
  const home = join(base, 'home');
  for (const folder of ['.claude', '.copilot', '.codex']) await mkdir(join(home, folder), { recursive: true });
  const context: ShareContext = { home, mode: 'custom', read: async () => [], build: 'test', settingsPath: join(base, 'settings.json'), realHome: join(base, 'real') };
  return { base, home, context, cleanup: () => rm(base, { recursive: true, force: true }) };
}
const claudeJson = (servers: Record<string, unknown>) => `${JSON.stringify({ numStartups: 7, oauthAccount: { emailAddress: 'kept@example.com' }, mcpServers: servers, projects: { '/x': {} } }, null, 2)}\n`;
const codexToml = `model = "gpt-6"
# my comment stays

[mcp_servers.node_repl]
command = "/Applications/ChatGPT.app/Contents/Resources/node"
args = ["repl"]

[profiles.work]
model = "o3"
`;
const massive = { type: 'stdio', command: 'npx', args: ['-y', 'massive'], env: { MASSIVE_TOKEN: 'secret-value-123' } };
const copilotOf = async (home: string) => JSON.parse(await readFile(join(home, '.copilot/mcp-config.json'), 'utf8')).mcpServers;

test('A managed Claude server reaches Copilot and Codex with values as-is; other bytes stay; ChatGPT desktop entries are never offered', async () => {
  const box = await sandbox();
  try {
    await writeFile(join(box.home, '.claude.json'), claudeJson({ massive }));
    await writeFile(join(box.home, '.codex/config.toml'), codexToml);
    const view = await mcpView(box.context, tools);
    assert.deepEqual(view.servers.map(server => server.key), ['massive', 'node_repl']);
    assert.match(view.servers.find(server => server.key === 'node_repl')!.held ?? '', /ChatGPT desktop/);
    const result = await applyMcp(box.context, tools, [{ key: 'massive', managed: true, off: [] }]);
    assert.equal(result.writes, 2, JSON.stringify(result.results));
    assert.deepEqual((await copilotOf(box.home)).massive, { type: 'local', command: 'npx', args: ['-y', 'massive'], env: { MASSIVE_TOKEN: 'secret-value-123' }, tools: ['*'] });
    const toml = await readFile(join(box.home, '.codex/config.toml'), 'utf8');
    assert.ok(toml.startsWith(codexToml), 'everything already in config.toml stays byte for byte');
    assert.ok(toml.includes('[mcp_servers.massive]\ncommand = "npx"\nargs = ["-y", "massive"]') && toml.includes('[mcp_servers.massive.env]\nMASSIVE_TOKEN = "secret-value-123"'));
    assert.equal((await applyMcp(box.context, tools, [])).writes, 0, 'a repeat writes nothing');
  } finally { await box.cleanup(); }
});

test('Claude Code is written only by Write now, editing only its entry', async () => {
  const box = await sandbox();
  try {
    const original = claudeJson({});
    await writeFile(join(box.home, '.claude.json'), original);
    await writeFile(join(box.home, '.copilot/mcp-config.json'), JSON.stringify({ mcpServers: { docs: { type: 'http', url: 'https://docs.example/mcp', headers: { Authorization: 'Bearer abc' } } } }, null, 2));
    const waiting = await applyMcp(box.context, tools, [{ key: 'docs', managed: true, off: [] }]);
    assert.ok(waiting.results.some(entry => entry.harness === 'claude-cli' && /Write now/.test(entry.message)));
    assert.equal(await readFile(join(box.home, '.claude.json'), 'utf8'), original, 'not touched without Write now');
    assert.deepEqual((await mcpView(box.context, tools)).claudePending, ['docs']);
    await applyMcp(box.context, tools, [], { claudeNow: ['docs'] });
    const written = await readFile(join(box.home, '.claude.json'), 'utf8');
    assert.deepEqual(JSON.parse(written).mcpServers.docs, { type: 'http', url: 'https://docs.example/mcp', headers: { Authorization: 'Bearer abc' } });
    assert.deepEqual(JSON.parse(written).oauthAccount, { emailAddress: 'kept@example.com' });
    assert.ok(written.includes('"projects": {\n    "/x": {}\n  }'), 'the rest keeps its layout');
  } finally { await box.cleanup(); }
});

test('An edit in one tool spreads; a deletion spreads once it holds; differing copies wait for a choice', async () => {
  const box = await sandbox();
  try {
    await writeFile(join(box.home, '.copilot/mcp-config.json'), JSON.stringify({ mcpServers: { tool: { type: 'local', command: 'a', tools: ['*'] } } }, null, 2));
    await applyMcp(box.context, tools, [{ key: 'tool', managed: true, off: ['claude-cli'] }]);
    let toml = await readFile(join(box.home, '.codex/config.toml'), 'utf8');
    await writeFile(join(box.home, '.codex/config.toml'), toml.replace('command = "a"', 'command = "b"'));
    await applyMcp(box.context, tools, []);
    assert.equal((await copilotOf(box.home)).tool.command, 'b', 'Codex edit reached Copilot');
    assert.deepEqual((await copilotOf(box.home)).tool.tools, ['*'], "Copilot's own field stays");
    await writeFile(join(box.home, '.copilot/mcp-config.json'), JSON.stringify({ mcpServers: {} }, null, 2));
    await applyMcp(box.context, tools, [], { now: 1000 });
    toml = await readFile(join(box.home, '.codex/config.toml'), 'utf8');
    assert.ok(toml.includes('[mcp_servers.tool]'), 'not removed while settling');
    await applyMcp(box.context, tools, [], { now: 5000 });
    assert.ok(!(await readFile(join(box.home, '.codex/config.toml'), 'utf8')).includes('[mcp_servers.tool]'), 'then removed');

    await writeFile(join(box.home, '.copilot/mcp-config.json'), JSON.stringify({ mcpServers: { twin: { command: 'x' } } }, null, 2));
    await writeFile(join(box.home, '.codex/config.toml'), '[mcp_servers.twin]\ncommand = "y"\n');
    const held = await applyMcp(box.context, tools, [{ key: 'twin', managed: true, off: ['claude-cli'] }]);
    assert.ok(held.results.some(entry => /Copies differ/.test(entry.message)));
    await applyMcp(box.context, tools, [{ key: 'twin', managed: true, off: ['claude-cli'], use: 'copilot-cli' }]);
    assert.ok((await readFile(join(box.home, '.codex/config.toml'), 'utf8')).includes('command = "x"'));
  } finally { await box.cleanup(); }
});

test('SSE cannot go to Codex, and an unreadable file is never written', async () => {
  const box = await sandbox();
  try {
    await writeFile(join(box.home, '.copilot/mcp-config.json'), JSON.stringify({ mcpServers: { stream: { type: 'sse', url: 'https://s.example/sse' } } }));
    await writeFile(join(box.home, '.codex/config.toml'), 'broken = [\n');
    const view = await mcpView(box.context, tools);
    assert.ok(view.problems.some(problem => /could not be read as TOML/.test(problem)));
    await applyMcp(box.context, tools, [{ key: 'stream', managed: true, off: ['claude-cli'] }]);
    assert.equal(await readFile(join(box.home, '.codex/config.toml'), 'utf8'), 'broken = [\n');
    await writeFile(join(box.home, '.codex/config.toml'), '');
    assert.match((await mcpView(box.context, tools)).servers[0].cannot['codex-cli'] ?? '', /SSE/);
  } finally { await box.cleanup(); }
});

test('MCP History: an edit that spread and a deletion are kept, and Undo or Restore put them back', async () => {
  const box = await sandbox();
  const { readHistory } = await import('../src/manage.ts');
  const { restoreMcp } = await import('../src/mcp.ts');
  try {
    await writeFile(join(box.home, '.copilot/mcp-config.json'), JSON.stringify({ mcpServers: { tool: { type: 'local', command: 'a', tools: ['*'] } } }, null, 2));
    await applyMcp(box.context, tools, [{ key: 'tool', managed: true, off: ['claude-cli'] }]);
    const toml = await readFile(join(box.home, '.codex/config.toml'), 'utf8');
    await writeFile(join(box.home, '.codex/config.toml'), toml.replace('command = "a"', 'command = "b"'));
    const spread = await applyMcp(box.context, tools, []);
    assert.deepEqual(spread.notices?.map(notice => [notice.kind, notice.winner, notice.losers]), [['edit', 'codex-cli', ['copilot-cli']]]);
    const [edit] = await readHistory(box.home);
    assert.equal(edit.key, 'mcp:tool');
    assert.equal((await restoreMcp(box.context, tools, edit.id)).stopped, undefined);
    assert.equal((await copilotOf(box.home)).tool.command, 'a', 'Undo put the old command back in Copilot');
    assert.ok((await readFile(join(box.home, '.codex/config.toml'), 'utf8')).includes('command = "a"'), 'and in Codex');
    assert.match((await restoreMcp(box.context, tools, edit.id)).stopped ?? '', /already undone/);
    await writeFile(join(box.home, '.copilot/mcp-config.json'), JSON.stringify({ mcpServers: {} }, null, 2));
    await applyMcp(box.context, tools, [], { now: 1000 });
    const gone = await applyMcp(box.context, tools, [], { now: 5000 });
    assert.equal(gone.notices?.[0]?.kind, 'deleted');
    const back = await restoreMcp(box.context, tools, gone.notices![0].history);
    assert.equal(back.stopped, undefined, JSON.stringify(back));
    assert.equal((await copilotOf(box.home)).tool.command, 'a', 'Restore brought it back');
    assert.ok((await readFile(join(box.home, '.codex/config.toml'), 'utf8')).includes('[mcp_servers.tool]'));
  } finally { await box.cleanup(); }
});

test('With Sync off, Apply all for one server writes only that server; an unrelated edit waits', async () => {
  const box = await sandbox();
  try {
    await writeFile(join(box.home, '.copilot/mcp-config.json'), JSON.stringify({ mcpServers: { one: { type: 'local', command: 'one', tools: ['*'] }, two: { type: 'local', command: 'two', tools: ['*'] } } }));
    await applyMcp(box.context, tools, [{ key: 'one', managed: true, off: ['claude-cli'] }, { key: 'two', managed: true, off: ['claude-cli'] }]);
    const toml = await readFile(join(box.home, '.codex/config.toml'), 'utf8');
    await writeFile(join(box.home, '.codex/config.toml'), toml.replace('command = "two"', 'command = "two-edited"'));
    await applyMcp(box.context, tools, [{ key: 'one', managed: false, off: [] }], { only: new Set(['one']) });
    assert.equal((await copilotOf(box.home)).two.command, 'two', 'the unrelated edit did not spread');
  } finally { await box.cleanup(); }
});
