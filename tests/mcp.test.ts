import { test } from 'node:test';
import assert from 'node:assert/strict';
import fsp from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { applyMcp, mcpView, readTool, restoreMcp, undoClaudeWrite } from '../src/mcp.ts';
import { readHistory } from '../src/manage.ts';
import { readRecord, syncGate, type ShareContext } from '../src/share.ts';
import { chooseTools } from '../src/toolchoice.ts';
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
    // Codex's own skill switches ([[skills.config]] blocks) sit in the same file and never stop its servers being read.
    const before = `${codexToml}\n[[skills.config]]\nname = "docs:pdf"\nenabled = false\n`;
    await writeFile(join(box.home, '.codex/config.toml'), before);
    const view = await mcpView(box.context, tools);
    assert.deepEqual(view.servers.map(server => server.key), ['massive', 'node_repl']);
    assert.match(view.servers.find(server => server.key === 'node_repl')!.held ?? '', /ChatGPT desktop/);
    const result = await applyMcp(box.context, tools, [{ key: 'massive', managed: true, off: [] }]);
    assert.equal(result.writes, 2, JSON.stringify(result.results));
    assert.deepEqual((await copilotOf(box.home)).massive, { type: 'local', command: 'npx', args: ['-y', 'massive'], env: { MASSIVE_TOKEN: 'secret-value-123' }, tools: ['*'] });
    const toml = await readFile(join(box.home, '.codex/config.toml'), 'utf8');
    assert.ok(toml.startsWith(before), 'everything already in config.toml stays byte for byte');
    assert.ok(toml.includes('[mcp_servers.massive]\ncommand = "npx"\nargs = ["-y", "massive"]') && toml.includes('[mcp_servers.massive.env]\nMASSIVE_TOKEN = "secret-value-123"'));
    assert.equal((await applyMcp(box.context, tools, [])).writes, 0, 'a repeat writes nothing');
  } finally { await box.cleanup(); }
});

test('A tool managed again starts from its own entries: an edit or deletion made there while it was left out does not spread', async () => {
  for (const change of ['edit', 'delete'] as const) {
    const box = await sandbox();
    try {
      // Codex keeps a server of its own, so taking this one out is a deletion, not a reset of the whole file.
      await writeFile(join(box.home, '.codex/config.toml'), codexToml);
      await writeFile(join(box.home, '.copilot/mcp-config.json'), copilotOne('a'));
      await applyMcp(box.context, tools, [{ key: 'tool', managed: true, off: ['claude-cli'] }]);
      // Left out, and changed there with no pass in between (Sync off).
      await chooseTools(box.context, ['claude-cli', 'copilot-cli']);
      const toml = await readFile(join(box.home, '.codex/config.toml'), 'utf8');
      const section = toml.slice(toml.indexOf('[mcp_servers.tool]'));
      await writeFile(join(box.home, '.codex/config.toml'), change === 'edit' ? toml.replace('command = "a"', 'command = "b"') : toml.replace(section, ''));
      await chooseTools(box.context, tools);
      await applyMcp(box.context, tools, [], { settleMs: 0 });
      await applyMcp(box.context, tools, [], { settleMs: 0 });
      assert.equal((await copilotOf(box.home)).tool?.command, 'a', `the ${change} in Codex did not spread`);
      assert.match(await readFile(join(box.home, '.codex/config.toml'), 'utf8'), change === 'edit' ? /command = "b"/ : /\[mcp_servers\.tool\]\ncommand = "a"/, 'Codex keeps its edit, or gets the server back');
    } finally { await box.cleanup(); }
  }
});

test('Claude Code is written only by Write now, editing only its entry; Undo removes a new entry and it waits for Write again', async () => {
  const box = await sandbox();
  try {
    const original = claudeJson({});
    await writeFile(join(box.home, '.claude.json'), original);
    await writeFile(join(box.home, '.copilot/mcp-config.json'), JSON.stringify({ mcpServers: { docs: { type: 'http', url: 'https://docs.example/mcp', headers: { Authorization: 'Bearer abc' } } } }, null, 2));
    const waiting = await applyMcp(box.context, tools, [{ key: 'docs', managed: true, off: [] }]);
    assert.ok(waiting.results.some(entry => entry.harness === 'claude-cli' && /Write now/.test(entry.message)));
    assert.equal(await readFile(join(box.home, '.claude.json'), 'utf8'), original, 'not touched without Write now');
    assert.deepEqual((await mcpView(box.context, tools)).claudePending, ['docs']);
    const wrote = await applyMcp(box.context, tools, [], { claudeNow: ['docs'] });
    assert.equal(wrote.claudeWritten?.length, 1);
    assert.equal(wrote.claudeWritten?.[0].before, null, 'it was new in Claude Code');
    const written = await readFile(join(box.home, '.claude.json'), 'utf8');
    assert.deepEqual(JSON.parse(written).mcpServers.docs, { type: 'http', url: 'https://docs.example/mcp', headers: { Authorization: 'Bearer abc' } });
    assert.deepEqual(JSON.parse(written).oauthAccount, { emailAddress: 'kept@example.com' });
    assert.ok(written.includes('"projects": {\n    "/x": {}\n  }'), 'the rest keeps its layout');
    const undone = await undoClaudeWrite(box.context, wrote.claudeWritten!);
    assert.equal(undone.stopped, undefined, undone.stopped ?? '');
    const after = JSON.parse(await readFile(join(box.home, '.claude.json'), 'utf8'));
    assert.equal(after.mcpServers?.docs, undefined, 'the entry is gone again');
    assert.deepEqual(after.oauthAccount, { emailAddress: 'kept@example.com' }, 'the rest stays');
    assert.deepEqual((await mcpView(box.context, tools)).claudePending, ['docs'], 'and it waits for Write again');
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
    // With no copy left it stays on offer, off, until it is put back.
    assert.deepEqual(((await mcpView(box.context, tools)).gone ?? []).map(server => [server.key, server.gone?.history]), [['tool', gone.notices![0].history]]);
    assert.equal((await restoreMcp(box.context, tools, gone.notices![0].history)).stopped, undefined);
    assert.deepEqual((await mcpView(box.context, tools)).gone, []);
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

test("With Sync off, Apply all never spreads a pending edit, neither for another server nor for that server's own", async () => {
  const box = await sandbox();
  try {
    await writeFile(join(box.home, '.copilot/mcp-config.json'), copilotOne('a'));
    await applyMcp(box.context, tools, [{ key: 'tool', managed: true, off: ['claude-cli'] }]);
    await writeFile(join(box.home, '.copilot/mcp-config.json'), copilotOne('edited'));
    assert.equal((await applyMcp(box.context, tools, [], { only: new Set(['other']) })).writes, 0);
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

test('Write now catching up a Claude Code copy that fell behind records the overwritten entry, and no made-up edit', async () => {
  const box = await sandbox();
  try {
    const two: HarnessId[] = ['copilot-cli', 'claude-cli'];
    const copilot = join(box.home, '.copilot/mcp-config.json');
    await writeFile(copilot, copilotOne('A'));
    await writeFile(join(box.home, '.claude.json'), claudeJson({ tool: { type: 'stdio', command: 'A' } }));
    await applyMcp(box.context, two, [{ key: 'tool', managed: true, off: [] }]);
    const previous = (await readTool(box.context, 'claude-cli')).entries[0].hash;
    await writeFile(copilot, copilotOne('B'));
    await applyMcp(box.context, two, []);
    await applyMcp(box.context, two, [], { claudeNow: ['tool'] });
    await applyMcp(box.context, two, []);
    assert.equal((await readTool(box.context, 'claude-cli')).entries[0].server.command, 'B');
    const history = await readHistory(box.context);
    assert.ok(history.some(event => event.kind === 'edit' && event.previous === previous), JSON.stringify(history));
    assert.ok(!history.some(event => event.winner?.tool === 'claude-cli' && event.losers.some(loser => loser.tool === 'claude-cli')), 'no made-up edit blames Claude Code');
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

test('A damaged, unreadable or newer MCP record stops every write and is never rewritten; a missing one is a first run', async () => {
  const box = await sandbox();
  try {
    await writeFile(join(box.home, '.claude.json'), claudeJson({ massive }));
    const first = await applyMcp(box.context, tools, [{ key: 'massive', managed: true, off: [] }]);
    assert.equal(first.writes, 2, 'a missing record is a first run');
    const recordFile = join(box.home, '.central-knot/mcp.json');
    const good = await readFile(recordFile, 'utf8');
    assert.equal(JSON.parse(good).formatVersion, 1);
    // An edit in Copilot that a pass would spread to Codex.
    const copilot = JSON.parse(await readFile(join(box.home, '.copilot/mcp-config.json'), 'utf8'));
    copilot.mcpServers.massive.args = ['-y', 'massive@2'];
    await writeFile(join(box.home, '.copilot/mcp-config.json'), JSON.stringify(copilot, null, 2));
    const files = ['.claude.json', '.copilot/mcp-config.json', '.codex/config.toml'];
    const before = await Promise.all(files.map(file => readFile(join(box.home, file), 'utf8')));
    const edit = (await readHistory(box.context)).at(-1)!;
    const bad: [string, RegExp][] = [
      ['{"formatVersion": 1, "items": {', /The MCP record is damaged\. Nothing was written or deleted/],
      [JSON.stringify({ formatVersion: 1, items: [] }), /The MCP record is damaged\./],
      [JSON.stringify({ formatVersion: 1, items: { massive: { state: 'shared', hash: 'x' } } }), /The MCP record is damaged\./],
      [JSON.stringify({ formatVersion: 'one', items: {} }), /The MCP record is damaged\./],
      [JSON.stringify({ items: JSON.parse(good).items }), /The MCP record is damaged\./],
      [JSON.stringify({ ...JSON.parse(good), formatVersion: 2 }), /The MCP record was written by a newer Central Knot\. Nothing was written or deleted/],
    ];
    for (const [text, reason] of bad) {
      await writeFile(recordFile, text);
      assert.match((await applyMcp(box.context, tools, [])).stopped ?? '', reason);
      assert.match((await applyMcp(box.context, tools, [{ key: 'massive', managed: false, off: [] }])).stopped ?? '', reason);
      assert.match((await applyMcp(box.context, tools, [], { claudeNow: ['massive'] })).stopped ?? '', reason);
      assert.match((await restoreMcp(box.context, tools, edit.id)).stopped ?? '', reason);
      assert.match((await undoClaudeWrite(box.context, [{ name: 'massive', before: null, after: 'x' }])).stopped ?? '', reason);
      const view = await mcpView(box.context, tools);
      assert.deepEqual(view.servers.map(server => server.key), ['massive'], 'the page still reads');
      assert.ok(view.gate.state === 'stopped' && reason.test(view.gate.reason));
      assert.ok(view.problems.some(problem => reason.test(problem)));
      assert.equal(await readFile(recordFile, 'utf8'), text, 'the record is left as it is');
      assert.deepEqual(await Promise.all(files.map(file => readFile(join(box.home, file), 'utf8'))), before, 'no tool file changed');
    }
    await rm(recordFile);
    await mkdir(recordFile);
    assert.match((await applyMcp(box.context, tools, [])).stopped ?? '', /The MCP record could not be read\. Nothing was written or deleted/);
    assert.deepEqual(await Promise.all(files.map(file => readFile(join(box.home, file), 'utf8'))), before);
    await rm(recordFile, { recursive: true });
    await writeFile(recordFile, good);
    const resumed = await applyMcp(box.context, tools, []);
    assert.equal(resumed.stopped, undefined);
    assert.match(await readFile(join(box.home, '.codex/config.toml'), 'utf8'), /massive@2/, 'with the record back, the edit spreads');
  } finally { await box.cleanup(); }
});

test('With an intact record this app has no memory of, Apply stops until an explicit Resume, which keeps the record and remembers it', async () => {
  const box = await sandbox();
  try {
    await writeFile(join(box.home, '.copilot/mcp-config.json'), copilotOne('a'));
    await applyMcp(box.context, tools, [{ key: 'tool', managed: true, off: ['claude-cli'] }]);
    const generation = (await readRecord(box.home)).record!.generation;
    await rm(join(box.base, 'settings.json'));
    await writeFile(join(box.home, '.copilot/mcp-config.json'), JSON.stringify({ mcpServers: { tool: { type: 'local', command: 'a', tools: ['*'] }, more: { type: 'local', command: 'm', tools: ['*'] } } }));
    assert.equal((await syncGate(box.context)).state, 'needs-resume');
    const blocked = await applyMcp(box.context, tools, [{ key: 'more', managed: true, off: ['claude-cli'] }]);
    assert.match(blocked.stopped ?? '', /no memory/);
    assert.equal(blocked.writes, 0);
    assert.equal((await syncGate(box.context)).state, 'needs-resume');
    const resumed = await applyMcp(box.context, tools, [{ key: 'more', managed: true, off: ['claude-cli'] }], { resume: true });
    assert.equal(resumed.stopped, undefined);
    assert.equal(resumed.writes, 1, JSON.stringify(resumed.results));
    assert.match(await readFile(join(box.home, '.codex/config.toml'), 'utf8'), /\[mcp_servers\.more\]/);
    assert.equal((await readRecord(box.home)).record!.generation, generation);
    assert.equal((await syncGate(box.context)).state, 'ready');
  } finally { await box.cleanup(); }
});

test('A deletion asked for now (decideNow) is a deletion even when it empties a tool’s servers section, never read as a reset', async () => {
  const box = await sandbox();
  try {
    const plain = 'model = "gpt-6"\n';
    await writeFile(join(box.home, '.copilot/mcp-config.json'), copilotOne('tool-server'));
    await writeFile(join(box.home, '.codex/config.toml'), plain);
    await applyMcp(box.context, tools, [{ key: 'tool', managed: true, off: [] }]);
    assert.match(await readFile(join(box.home, '.codex/config.toml'), 'utf8'), /\[mcp_servers\.tool\]/);
    // Its table removed from Codex, as Pull removes a server the repo deleted: the file is left with no servers section.
    await writeFile(join(box.home, '.codex/config.toml'), plain);
    await applyMcp(box.context, tools, [], { decideNow: new Set(['tool']) });
    assert.equal((await copilotOf(box.home)).tool, undefined, 'the deletion spread');
    assert.equal(await readFile(join(box.home, '.codex/config.toml'), 'utf8'), plain, 'nothing written back');
  } finally { await box.cleanup(); }
});

test('A server disabled in one tool is enabled again by hand, and Undo turns it back off: only the named tool’s own switch changes', async () => {
  const box = await sandbox();
  try {
    const hindsight = { type: 'http', url: 'http://127.0.0.1:8888/mcp/nathan-personal/' };
    await writeFile(join(box.home, '.claude.json'), claudeJson({ hindsight }));
    await applyMcp(box.context, tools, [{ key: 'hindsight', managed: true, off: [] }]);
    // Turned off in Copilot CLI (as `copilot mcp disable` writes it) and in Codex, outside Central Knot.
    const copilotSettings = join(box.home, '.copilot/settings.json');
    await writeFile(copilotSettings, '{\n  "theme": "dark",\n  "disabledMcpServers": ["hindsight", "other"]\n}\n');
    const codexFile = join(box.home, '.codex/config.toml');
    await writeFile(codexFile, (await readFile(codexFile, 'utf8')).replace('[mcp_servers.hindsight]\n', '[mcp_servers.hindsight]\nenabled = false\n'));
    const disabledIn = async () => (await mcpView(box.context, tools)).servers.find(server => server.key === 'hindsight')!.disabled ?? [];
    assert.deepEqual((await disabledIn()).sort(), ['codex-cli', 'copilot-cli']);
    const entries = await readFile(join(box.home, '.copilot/mcp-config.json'), 'utf8');

    const enabled = await applyMcp(box.context, tools, [{ key: 'hindsight', managed: true, off: [], enable: ['copilot-cli'] }]);
    assert.deepEqual(enabled.results.map(result => [result.harness, result.outcome, result.disabled]), [['copilot-cli', 'switched', false]]);
    assert.deepEqual(JSON.parse(await readFile(copilotSettings, 'utf8')), { theme: 'dark', disabledMcpServers: ['other'] }, 'only this server’s switch; the rest of the file stays');
    assert.deepEqual(await disabledIn(), ['codex-cli'], 'Codex was not named, so it stays off');
    assert.equal(await readFile(join(box.home, '.copilot/mcp-config.json'), 'utf8'), entries, 'the server’s entry is untouched');
    const made = (await readHistory(box.context)).filter(event => event.kind === 'switched');
    assert.deepEqual(made.map(event => [event.key, event.switched]), [['mcp:hindsight', [{ tool: 'copilot-cli', disabled: false }]]]);
    // Asking again changes nothing and records nothing.
    const again = await applyMcp(box.context, tools, [{ key: 'hindsight', managed: true, off: [], enable: ['copilot-cli'] }]);
    assert.deepEqual([again.results, (await readHistory(box.context)).filter(event => event.kind === 'switched').length], [[], 1]);

    const undone = await restoreMcp(box.context, tools, made[0].id);
    assert.deepEqual(undone.results.map(result => [result.harness, result.outcome, result.disabled]), [['copilot-cli', 'switched', true]]);
    assert.deepEqual((await disabledIn()).sort(), ['codex-cli', 'copilot-cli']);
    assert.match((await restoreMcp(box.context, tools, made[0].id)).stopped ?? '', /already undone/);

    // Disable by hand: Codex's switch is a line in the server's own table, and the copies still count as the same.
    await applyMcp(box.context, tools, [{ key: 'hindsight', managed: true, off: [], enable: ['codex-cli', 'copilot-cli'] }]);
    assert.deepEqual(await disabledIn(), []);
    const off = await applyMcp(box.context, tools, [{ key: 'hindsight', managed: true, off: [], disable: ['codex-cli'] }]);
    assert.deepEqual(off.results.map(result => [result.harness, result.outcome, result.disabled]), [['codex-cli', 'switched', true]]);
    assert.match(await readFile(codexFile, 'utf8'), /\[mcp_servers\.hindsight\]\n(.+\n)*enabled = false\n/);
    assert.equal((await applyMcp(box.context, tools, [])).writes, 0, 'a switch is not an edit to spread');
  } finally { await box.cleanup(); }
});

test('A switch that can’t be made is said, and nothing else is changed: Codex has no entry to turn off', async () => {
  const box = await sandbox();
  try {
    await writeFile(join(box.home, '.claude.json'), claudeJson({ massive }));
    await writeFile(join(box.home, '.codex/config.toml'), codexToml);
    const result = await applyMcp(box.context, tools, [{ key: 'massive', managed: false, off: [], disable: ['codex-cli', 'claude-cli'] }]);
    assert.deepEqual(result.results.map(result => [result.harness, result.outcome]), [['codex-cli', 'failed'], ['claude-cli', 'switched']]);
    assert.match(result.results[0].message, /Could not disable it in Codex: Codex has no \[mcp_servers\.massive\] table to switch\./);
    assert.equal(await readFile(join(box.home, '.codex/config.toml'), 'utf8'), codexToml);
    assert.deepEqual(JSON.parse(await readFile(join(box.home, '.claude/settings.json'), 'utf8')), { deniedMcpServers: [{ serverName: 'massive' }] });
  } finally { await box.cleanup(); }
});

test('A click is told the History entries it made: On, Off, Sync here (written to a tool synced again) and a stale page refused; Undo of each puts the files back', async () => {
  const box = await sandbox();
  try {
    await writeFile(join(box.home, '.copilot/mcp-config.json'), copilotOne('a'));
    const kinds = async (ids?: string[]) => { const history = await readHistory(box.context); return (ids ?? []).map(id => history.find(event => event.id === id)?.kind); };
    const on = await applyMcp(box.context, tools, [{ key: 'tool', managed: true, off: ['claude-cli'], seenManaged: false }]);
    assert.deepEqual(await kinds(on.made), ['added']);
    const switchFiles = async () => [await readFile(join(box.home, '.copilot/settings.json'), 'utf8').catch(() => ''), await readFile(join(box.home, '.codex/config.toml'), 'utf8')];
    const before = await switchFiles();
    const off = await applyMcp(box.context, tools, [{ key: 'tool', managed: true, off: ['claude-cli'], seenManaged: true, disable: ['copilot-cli', 'codex-cli'] }]);
    assert.deepEqual(await kinds(off.made), ['switched']);
    assert.equal((await restoreMcp(box.context, tools, off.made![0])).stopped, undefined);
    // Each switch back as it was (Copilot CLI's settings file, made by the switch, is left as an empty object).
    const settled = (texts: string[]) => texts.map(text => text.trim() || '{}');
    assert.deepEqual(settled(await switchFiles()), settled(before));
    // Codex left out, its entry taken out by hand; Sync here writes it again, as an entry its Undo takes back out.
    await applyMcp(box.context, tools, [{ key: 'tool', managed: true, off: ['claude-cli', 'codex-cli'], seenManaged: true }]);
    await writeFile(join(box.home, '.codex/config.toml'), codexToml);
    const again = await applyMcp(box.context, tools, [{ key: 'tool', managed: true, off: ['claude-cli'], seenManaged: true }]);
    assert.ok((await readFile(join(box.home, '.codex/config.toml'), 'utf8')).includes('[mcp_servers.tool]'));
    const added = (await readHistory(box.context)).find(event => event.id === again.made?.[0]);
    assert.deepEqual([added?.kind, added?.rejoined, added?.losers.map(loser => loser.tool)], ['added', true, ['codex-cli']]);
    assert.equal((await restoreMcp(box.context, tools, added!.id)).stopped, undefined);
    assert.equal((await readFile(join(box.home, '.codex/config.toml'), 'utf8')).trimEnd(), codexToml.trimEnd(), 'Codex as it was');
    const after = (await mcpView(box.context, tools)).servers.find(server => server.key === 'tool')!;
    assert.deepEqual([after.managed, after.off.includes('codex-cli')], [true, true], 'still synced, Codex left out again');
    // A change from a page read before it was synced is refused, changing nothing.
    const stale = await applyMcp(box.context, tools, [{ key: 'tool', managed: false, off: [], seenManaged: false }]);
    assert.match(stale.results.find(entry => entry.item === 'tool')?.message ?? '', /changed since the page was read/);
    assert.equal((await mcpView(box.context, tools)).servers.find(server => server.key === 'tool')?.managed, true);
  } finally { await box.cleanup(); }
});

test('Undo of an MCP copy choice puts each replaced entry back in its own tool and takes the added one out; the server is not synced again', async () => {
  const box = await sandbox();
  try {
    const four: HarnessId[] = [...tools, 'pi-cli'];
    await mkdir(join(box.home, '.pi/agent'), { recursive: true });
    await writeFile(join(box.home, '.copilot/mcp-config.json'), copilotOne('x'));
    await writeFile(join(box.home, '.codex/config.toml'), '[mcp_servers.tool]\ncommand = "y"\n');
    const codexBefore = await readFile(join(box.home, '.codex/config.toml'), 'utf8');
    const chose = await applyMcp(box.context, four, [{ key: 'tool', managed: true, off: ['claude-cli'], seenManaged: false, use: 'copilot-cli' }]);
    const history = await readHistory(box.context);
    const chosen = history.find(event => chose.made?.includes(event.id) && event.kind === 'chosen')!;
    assert.deepEqual(chose.made?.map(id => history.find(event => event.id === id)?.kind).sort(), ['added', 'chosen']);
    assert.match(await readFile(join(box.home, '.pi/agent/mcp.json'), 'utf8'), /"x"/);
    assert.equal((await restoreMcp(box.context, four, chosen.id, 'narrow')).stopped, undefined);
    assert.equal(await readFile(join(box.home, '.codex/config.toml'), 'utf8'), codexBefore, 'Codex has its own entry back');
    assert.equal((await copilotOf(box.home)).tool.command, 'x');
    assert.ok(!(await readFile(join(box.home, '.pi/agent/mcp.json'), 'utf8')).includes('"tool"'), 'the added Pi entry is gone');
    assert.equal((await mcpView(box.context, four)).servers.find(server => server.key === 'tool')?.managed, false);
    assert.equal((await applyMcp(box.context, four, [])).writes, 0, 'nothing is caught up over either copy');
  } finally { await box.cleanup(); }
});

test('Undo of putting a deleted server back is the deletion again: its entries go, and it is off with no entry left, to put back again', async () => {
  const box = await sandbox();
  try {
    await writeFile(join(box.home, '.copilot/mcp-config.json'), copilotOne('a'));
    await applyMcp(box.context, tools, [{ key: 'tool', managed: true, off: ['claude-cli'] }]);
    await writeFile(join(box.home, '.copilot/mcp-config.json'), JSON.stringify({ mcpServers: {} }, null, 2));
    const deleted = await applyMcp(box.context, tools, [], { settleMs: 0 });
    const back = await restoreMcp(box.context, tools, deleted.notices![0].history);
    assert.deepEqual([back.stopped, back.made?.length], [undefined, 1]);
    assert.equal((await copilotOf(box.home)).tool.command, 'a');
    const again = await restoreMcp(box.context, tools, back.made![0]);
    assert.equal(again.stopped, undefined, JSON.stringify(again));
    assert.equal((await copilotOf(box.home)).tool, undefined);
    assert.ok(!(await readFile(join(box.home, '.codex/config.toml'), 'utf8')).includes('[mcp_servers.tool]'));
    const gone = (await mcpView(box.context, tools)).gone ?? [];
    assert.deepEqual(gone.map(server => [server.key, server.gone?.history]), [['tool', again.made![0]]]);
    assert.equal((await restoreMcp(box.context, tools, again.made![0])).stopped, undefined);
    assert.equal((await copilotOf(box.home)).tool.command, 'a', 'and it can be put back again');
  } finally { await box.cleanup(); }
});
