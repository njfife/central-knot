import { test } from 'node:test';
import assert from 'node:assert/strict';
import fsp from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { applyMcp, mcpView, restoreMcp, undoClaudeWrite } from '../src/mcp.ts';
import { readHistory } from '../src/manage.ts';
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
const copilotOne = (command: string) => JSON.stringify({ mcpServers: { tool: { type: 'local', command, tools: ['*'] } } });

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

test('An edit spreads and Undo reverts it; a deletion spreads once it holds and Restore brings it back; differing copies wait for a choice', async () => {
  const box = await sandbox();
  try {
    await writeFile(join(box.home, '.copilot/mcp-config.json'), JSON.stringify({ mcpServers: { tool: { type: 'local', command: 'a', tools: ['*'] } } }, null, 2));
    await applyMcp(box.context, tools, [{ key: 'tool', managed: true, off: ['claude-cli'] }]);
    let toml = await readFile(join(box.home, '.codex/config.toml'), 'utf8');
    await writeFile(join(box.home, '.codex/config.toml'), toml.replace('command = "a"', 'command = "b"'));
    const spread = await applyMcp(box.context, tools, []);
    assert.deepEqual(spread.notices?.map(notice => [notice.kind, notice.winner, notice.losers]), [['edit', 'codex-cli', ['copilot-cli']]]);
    assert.equal((await copilotOf(box.home)).tool.command, 'b', 'Codex edit reached Copilot');
    assert.deepEqual((await copilotOf(box.home)).tool.tools, ['*'], "Copilot's own field stays");
    const edit = (await readHistory(box.context)).find(event => event.kind === 'edit' && event.key === 'mcp:tool')!;
    assert.equal((await restoreMcp(box.context, tools, edit.id)).stopped, undefined);
    assert.equal((await copilotOf(box.home)).tool.command, 'a', 'Undo put the old command back in Copilot');
    assert.ok((await readFile(join(box.home, '.codex/config.toml'), 'utf8')).includes('command = "a"'), 'and in Codex');
    assert.match((await restoreMcp(box.context, tools, edit.id)).stopped ?? '', /already undone/);
    await writeFile(join(box.home, '.copilot/mcp-config.json'), JSON.stringify({ mcpServers: {} }, null, 2));
    await applyMcp(box.context, tools, [], { now: 1000 });
    toml = await readFile(join(box.home, '.codex/config.toml'), 'utf8');
    assert.ok(toml.includes('[mcp_servers.tool]'), 'not removed while settling');
    const gone = await applyMcp(box.context, tools, [], { now: 5000 });
    assert.ok(!(await readFile(join(box.home, '.codex/config.toml'), 'utf8')).includes('[mcp_servers.tool]'), 'then removed');
    assert.equal(gone.notices?.[0]?.kind, 'deleted');
    assert.equal((await restoreMcp(box.context, tools, gone.notices![0].history)).stopped, undefined);
    assert.equal((await copilotOf(box.home)).tool.command, 'a', 'Restore brought it back');
    assert.ok((await readFile(join(box.home, '.codex/config.toml'), 'utf8')).includes('[mcp_servers.tool]'));

    await writeFile(join(box.home, '.copilot/mcp-config.json'), JSON.stringify({ mcpServers: { twin: { command: 'x' } } }, null, 2));
    await writeFile(join(box.home, '.codex/config.toml'), '[mcp_servers.twin]\ncommand = "y"\n');
    const held = await applyMcp(box.context, tools, [{ key: 'twin', managed: true, off: ['claude-cli'] }]);
    assert.ok(held.results.some(entry => /Copies differ/.test(entry.message)));
    await applyMcp(box.context, tools, [{ key: 'twin', managed: true, off: ['claude-cli'], use: 'copilot-cli' }]);
    assert.ok((await readHistory(box.context)).some(e => e.kind === 'chosen' && e.key === 'mcp:twin' && e.losers.some(l => l.tool === 'codex-cli')), 'the replaced copy is in History');
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

test("With Sync off, Apply all for a server holds that server's own pending edit", async () => {
  const box = await sandbox();
  try {
    await writeFile(join(box.home, '.copilot/mcp-config.json'), copilotOne('a'));
    await applyMcp(box.context, tools, [{ key: 'tool', managed: true, off: ['claude-cli'] }]);
    await writeFile(join(box.home, '.copilot/mcp-config.json'), copilotOne('edited'));
    await applyMcp(box.context, tools, [{ key: 'tool', managed: true, off: ['claude-cli'] }], { only: new Set(['tool']) });
    assert.ok(!(await readFile(join(box.home, '.codex/config.toml'), 'utf8')).includes('edited'));
  } finally { await box.cleanup(); }
});

test('An MCP edit saved while a pass is writing is not overwritten, and wins the next pass', async () => {
  const box = await sandbox();
  const copilotPath = join(box.home, '.copilot/mcp-config.json');
  const codexPath = join(box.home, '.codex/config.toml');
  const original = fsp.readFile;
  try {
    await writeFile(copilotPath, copilotOne('a'));
    await applyMcp(box.context, tools, [{ key: 'tool', managed: true, off: ['claude-cli'] }]);
    await writeFile(codexPath, (await readFile(codexPath, 'utf8')).replace('command = "a"', 'command = "b"'));
    let reads = 0;
    (fsp as any).readFile = async (path: any, ...rest: any[]) => {
      if (String(path) === copilotPath && ++reads === 2) await fsp.writeFile(copilotPath, copilotOne('USER-EDIT'));
      return (original as any).call(fsp, path, ...rest);
    };
    syncBuiltinESMExports();
    await applyMcp(box.context, tools, []);
    (fsp as any).readFile = original; syncBuiltinESMExports();
    await applyMcp(box.context, tools, []);
    assert.equal((await copilotOf(box.home)).tool.command, 'USER-EDIT');
  } finally { (fsp as any).readFile = original; syncBuiltinESMExports(); await box.cleanup(); }
});

test('A tool turned off forgets its copy: turned back on with an emptied file, it gets the entry back and nothing is deleted', async () => {
  const box = await sandbox();
  try {
    await writeFile(join(box.home, '.copilot/mcp-config.json'), copilotOne('a'));
    await applyMcp(box.context, tools, [{ key: 'tool', managed: true, off: ['claude-cli'] }]);
    await applyMcp(box.context, tools, [{ key: 'tool', managed: true, off: ['claude-cli', 'codex-cli'] }]);
    await writeFile(join(box.home, '.codex/config.toml'), '');
    await applyMcp(box.context, tools, [{ key: 'tool', managed: true, off: ['claude-cli'] }], { settleMs: 0 });
    await applyMcp(box.context, tools, [], { settleMs: 0 });
    assert.equal((await copilotOf(box.home)).tool.command, 'a');
    assert.match(await readFile(join(box.home, '.codex/config.toml'), 'utf8'), /command = "a"/);
  } finally { await box.cleanup(); }
});

test('Apply all records the entries it adds; Undo removes them while unchanged, keeps the rest of each file, and unmanages', async () => {
  const box = await sandbox();
  try {
    await writeFile(join(box.home, '.claude.json'), claudeJson({ massive }));
    await writeFile(join(box.home, '.codex/config.toml'), codexToml);
    await applyMcp(box.context, tools, [{ key: 'massive', managed: true, off: [] }]);
    const added = (await readHistory(box.context)).find(event => event.kind === 'added' && event.key === 'mcp:massive')!;
    assert.deepEqual(added.losers.map(loser => loser.tool).sort(), ['codex-cli', 'copilot-cli']);
    const undone = await restoreMcp(box.context, tools, added.id);
    assert.equal(undone.stopped, undefined, JSON.stringify(undone));
    assert.equal((await copilotOf(box.home)).massive, undefined, 'the added Copilot entry is gone');
    const toml = await readFile(join(box.home, '.codex/config.toml'), 'utf8');
    assert.ok(!toml.includes('[mcp_servers.massive]'), 'the added Codex entry is gone');
    assert.ok(toml.includes('model = "gpt-6"'), 'the rest of config.toml stays');
    assert.match(await readFile(join(box.home, '.claude.json'), 'utf8'), /secret-value-123/, 'the original entry is untouched');
    assert.equal((await mcpView(box.context, tools)).servers.find(server => server.key === 'massive')?.managed, false);
  } finally { await box.cleanup(); }
});

test('Pi: a managed server reaches ~/.pi/agent/mcp.json in the mcpServers shape; SSE is not written there', async () => {
  const box = await sandbox();
  try {
    await mkdir(join(box.home, '.pi/agent'), { recursive: true });
    const withPi: HarnessId[] = ['claude-cli', 'pi-cli'];
    const sse = { type: 'sse', url: 'https://events.example.test/sse' };
    await writeFile(join(box.home, '.claude.json'), claudeJson({ massive, stream: sse }));
    await applyMcp(box.context, withPi, [{ key: 'massive', managed: true, off: [] }, { key: 'stream', managed: true, off: [] }]);
    const pi = JSON.parse(await readFile(join(box.home, '.pi/agent/mcp.json'), 'utf8')).mcpServers;
    assert.deepEqual(pi.massive, { type: 'stdio', command: 'npx', args: ['-y', 'massive'], env: { MASSIVE_TOKEN: 'secret-value-123' } });
    assert.equal(pi.stream, undefined);
  } finally { await box.cleanup(); }
});

test('Undo of Write to Claude Code removes a new entry, keeps the rest of the file, and the server waits for Write again', async () => {
  const box = await sandbox();
  try {
    const original = claudeJson({});
    await writeFile(join(box.home, '.claude.json'), original);
    await writeFile(join(box.home, '.copilot/mcp-config.json'), JSON.stringify({ mcpServers: { docs: { type: 'http', url: 'https://docs.example/mcp' } } }, null, 2));
    await applyMcp(box.context, tools, [{ key: 'docs', managed: true, off: [] }]);
    const wrote = await applyMcp(box.context, tools, [], { claudeNow: ['docs'] });
    assert.equal(wrote.claudeWritten?.length, 1);
    assert.equal(wrote.claudeWritten?.[0].before, null, 'it was new in Claude Code');
    const undone = await undoClaudeWrite(box.context, wrote.claudeWritten!);
    assert.equal(undone.stopped, undefined, undone.stopped ?? '');
    const after = JSON.parse(await readFile(join(box.home, '.claude.json'), 'utf8'));
    assert.equal(after.mcpServers?.docs, undefined, 'the entry is gone again');
    assert.deepEqual(after.oauthAccount, { emailAddress: 'kept@example.com' }, 'the rest stays');
    assert.deepEqual((await mcpView(box.context, tools)).claudePending, ['docs'], 'and it waits for Write again');
  } finally { await box.cleanup(); }
});

test('Undo of Write to Claude Code puts back an older entry, and refuses when the entry changed since', async () => {
  const box = await sandbox();
  try {
    await writeFile(join(box.home, '.claude.json'), claudeJson({ docs: { type: 'http', url: 'https://old.example/mcp' } }));
    await writeFile(join(box.home, '.copilot/mcp-config.json'), JSON.stringify({ mcpServers: { docs: { type: 'http', url: 'https://old.example/mcp' } } }, null, 2));
    await applyMcp(box.context, tools, [{ key: 'docs', managed: true, off: [] }]);
    const copilot = JSON.parse(await readFile(join(box.home, '.copilot/mcp-config.json'), 'utf8'));
    copilot.mcpServers.docs.url = 'https://new.example/mcp';
    await writeFile(join(box.home, '.copilot/mcp-config.json'), JSON.stringify(copilot, null, 2));
    await applyMcp(box.context, tools, []);
    const wrote = await applyMcp(box.context, tools, [], { claudeNow: ['docs'] });
    assert.equal(JSON.parse(await readFile(join(box.home, '.claude.json'), 'utf8')).mcpServers.docs.url, 'https://new.example/mcp');
    const undone = await undoClaudeWrite(box.context, wrote.claudeWritten!);
    assert.equal(undone.stopped, undefined, undone.stopped ?? '');
    assert.equal(JSON.parse(await readFile(join(box.home, '.claude.json'), 'utf8')).mcpServers.docs.url, 'https://old.example/mcp', 'the older entry is back');
    assert.deepEqual((await mcpView(box.context, tools)).claudePending, ['docs']);
    // Written again, then changed in Claude Code: Undo writes nothing.
    const again = await applyMcp(box.context, tools, [], { claudeNow: ['docs'] });
    const claude = JSON.parse(await readFile(join(box.home, '.claude.json'), 'utf8'));
    claude.mcpServers.docs.url = 'https://edited-in-claude.example/mcp';
    await writeFile(join(box.home, '.claude.json'), JSON.stringify(claude, null, 2));
    const refused = await undoClaudeWrite(box.context, again.claudeWritten!);
    assert.ok(refused.stopped);
    assert.equal(JSON.parse(await readFile(join(box.home, '.claude.json'), 'utf8')).mcpServers.docs.url, 'https://edited-in-claude.example/mcp');
  } finally { await box.cleanup(); }
});
