import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readTomlTables, setJsonMember, setTomlTable, tomlHeader, tomlValue } from '../src/textedit.ts';

const claudeJson = `{
  "numStartups": 42,
  "mcpServers": {
    "massive": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "massive"],
      "env": { "TOKEN": "abc123" }
    }
  },
  "projects": { "/x": { "allowedTools": [] } }
}
`;

test('JSON: adding a server changes only that member', () => {
  const out = setJsonMember(claudeJson, ['mcpServers', 'docs'], { type: 'http', url: 'https://example.com/mcp' });
  assert.deepEqual(JSON.parse(out).mcpServers.docs, { type: 'http', url: 'https://example.com/mcp' });
  assert.deepEqual(JSON.parse(out).mcpServers.massive, JSON.parse(claudeJson).mcpServers.massive);
  assert.ok(out.startsWith(claudeJson.slice(0, claudeJson.indexOf('    }\n  },') + 5)), 'everything before the insertion is byte-identical');
  assert.ok(out.endsWith(`  },\n  "projects": { "/x": { "allowedTools": [] } }\n}\n`), 'everything after it too');
});

test('JSON: replacing and removing a member keep the rest byte for byte', () => {
  const replaced = setJsonMember(claudeJson, ['mcpServers', 'massive'], { type: 'stdio', command: 'node', args: [] });
  assert.equal(JSON.parse(replaced).mcpServers.massive.command, 'node');
  assert.equal(replaced.slice(0, replaced.indexOf('"massive"')), claudeJson.slice(0, claudeJson.indexOf('"massive"')));
  assert.equal(replaced.slice(replaced.indexOf('  },\n  "projects"')), claudeJson.slice(claudeJson.indexOf('  },\n  "projects"')));
  const two = setJsonMember(claudeJson, ['mcpServers', 'docs'], { url: 'u' });
  for (const name of ['massive', 'docs']) {
    const removed = setJsonMember(two, ['mcpServers', name], undefined);
    const parsed = JSON.parse(removed);
    assert.equal(parsed.mcpServers[name], undefined);
    assert.equal(Object.keys(parsed.mcpServers).length, 1);
    assert.equal(parsed.numStartups, 42);
  }
  const only = setJsonMember(claudeJson, ['mcpServers', 'massive'], undefined);
  assert.deepEqual(JSON.parse(only).mcpServers, {});
});

test('JSON: a missing parent object or an empty file is created', () => {
  const created = setJsonMember('{\n  "a": 1\n}\n', ['mcpServers', 'x'], { command: 'c' });
  assert.deepEqual(JSON.parse(created), { a: 1, mcpServers: { x: { command: 'c' } } });
  assert.deepEqual(JSON.parse(setJsonMember('', ['mcpServers', 'x'], { command: 'c' })), { mcpServers: { x: { command: 'c' } } });
  assert.deepEqual(JSON.parse(setJsonMember('{}', ['mcpServers', 'x'], { command: 'c' })), { mcpServers: { x: { command: 'c' } } });
});

test('JSON: strings with braces, escapes and comments do not confuse the scanner', () => {
  const tricky = '{\n  // a comment\n  "note": "a } { \\" ] [",\n  "mcpServers": { "a": { "command": "x" } }\n}\n';
  const out = setJsonMember(tricky, ['mcpServers', 'b'], { command: 'y' });
  assert.ok(out.includes('// a comment') && out.includes('"note": "a } { \\" ] ["'));
  assert.deepEqual(Object.keys(JSON.parse(out.replace('// a comment\n', '')).mcpServers), ['a', 'b']);
});

const codexToml = `model = "gpt-6"
# keep this comment

[mcp_servers.node_repl]
command = "/Applications/ChatGPT.app/node"
args = [
  "repl", # inline comment
  "--x",
]
startup_timeout_sec = 30

[mcp_servers.node_repl.env]
CODEX_HOME = "/Users/n/.codex"

[mcp_servers.massive]
url = "https://massive.example/mcp"
enabled = true
http_headers = { Authorization = "Bearer abc" }

[profiles.work]
model = "o3"
`;

test('TOML: MCP tables, subtables, inline tables and multi-line arrays are read', () => {
  const tables = readTomlTables(codexToml);
  const repl = tables.find(table => table.path.join('.') === 'mcp_servers.node_repl')!;
  assert.deepEqual(repl.entries.find(entry => entry.key === 'args')!.value, ['repl', '--x']);
  assert.equal(tables.find(table => table.path.join('.') === 'mcp_servers.node_repl.env')!.entries[0].value, '/Users/n/.codex');
  const massive = tables.find(table => table.path.join('.') === 'mcp_servers.massive')!;
  assert.deepEqual(massive.entries.find(entry => entry.key === 'http_headers')!.value, { Authorization: 'Bearer abc' });
  assert.equal(massive.entries.find(entry => entry.key === 'enabled')!.raw, 'enabled = true\n');
});

test('TOML: replacing, adding and removing a server table leaves every other byte alone', () => {
  const body = `${tomlHeader(['mcp_servers', 'massive'])}\nurl = ${tomlValue('https://new.example/mcp')}\nenabled = true\n`;
  const replaced = setTomlTable(codexToml, ['mcp_servers'], 'massive', body);
  assert.ok(replaced.includes('url = "https://new.example/mcp"') && !replaced.includes('Bearer abc'));
  assert.equal(replaced.slice(0, replaced.indexOf('[mcp_servers.massive]')), codexToml.slice(0, codexToml.indexOf('[mcp_servers.massive]')));
  assert.ok(replaced.endsWith('[profiles.work]\nmodel = "o3"\n'));
  const removed = setTomlTable(codexToml, ['mcp_servers'], 'node_repl', undefined);
  assert.ok(!removed.includes('node_repl') && removed.includes('# keep this comment') && removed.includes('[mcp_servers.massive]'));
  const added = setTomlTable(codexToml, ['mcp_servers'], 'my server', `${tomlHeader(['mcp_servers', 'my server'])}\ncommand = "x"\n`);
  assert.ok(added.startsWith(codexToml));
  assert.ok(added.endsWith('[mcp_servers."my server"]\ncommand = "x"\n'));
  assert.equal(readTomlTables(added).find(table => table.path[1] === 'my server')!.entries[0].value, 'x');
});
