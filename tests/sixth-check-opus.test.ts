// Reproductions from the Opus sixth check (15c8652), kept as regressions. P10 (a still-running Claude Code writing its old copy
// back after Write now) is prevented in the app instead: Write now refuses while Claude Code runs.
// Opus sixth check probes (15c8652). Each asserts the SAFE behaviour; a failure is a confirmed finding.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { applyAgents } from '../src/agents.ts';
import { applyMcp, readTool } from '../src/mcp.ts';
import { readTomlTables } from '../src/textedit.ts';
import type { ShareContext } from '../src/share.ts';
import type { HarnessId } from '../src/types.ts';

const tools: HarnessId[] = ['claude-cli', 'copilot-cli', 'codex-cli'];
const managed = (key: string) => [{ key, managed: true, off: [] as HarnessId[] }];
async function box(run: (b: { home: string; context: ShareContext }) => Promise<void>) {
  const base = await fs.mkdtemp(join(tmpdir(), 'ck-opus6-'));
  const home = join(base, 'home');
  for (const name of ['.claude', '.copilot', '.codex']) await fs.mkdir(join(home, name, 'agents'), { recursive: true });
  const context: ShareContext = { home, mode: 'custom', read: async () => [], build: 'test', settingsPath: join(base, 'settings.json'), realHome: join(base, 'real') };
  try { await run({ home, context }); } finally { await fs.rm(base, { recursive: true, force: true }); }
}
const copilot = (home: string) => join(home, '.copilot', 'mcp-config.json');
const codex = (home: string) => join(home, '.codex', 'config.toml');

test('P1 Codex subtables of a server other than env survive a sync write', () => box(async ({ home, context }) => {
  await fs.writeFile(copilot(home), JSON.stringify({ mcpServers: { docs: { type: 'http', url: 'https://a.example/mcp', tools: ['*'] } } }));
  await fs.writeFile(codex(home), '[mcp_servers.docs]\nurl = "https://a.example/mcp"\nenabled = true\n\n[mcp_servers.docs.env_http_headers]\nX_REGION = "REGION_VAR"\n\n[mcp_servers.docs.tools.search]\napproval_mode = "approve"\n');
  await applyMcp(context, tools.slice(1), managed('docs'));
  // An edit in Copilot spreads to Codex.
  await fs.writeFile(copilot(home), JSON.stringify({ mcpServers: { docs: { type: 'http', url: 'https://b.example/mcp', tools: ['*'] } } }));
  await applyMcp(context, tools.slice(1), []);
  const text = await fs.readFile(codex(home), 'utf8');
  assert.match(text, /b\.example/, 'edit did not spread');
  assert.match(text, /env_http_headers/, `Codex's own env_http_headers table was dropped:\n${text}`);
  assert.match(text, /approval_mode/, `Codex's own per-tool table was dropped:\n${text}`);
}));

test('P2 Codex http_headers written as a table is read and kept', () => box(async ({ home, context }) => {
  await fs.writeFile(codex(home), '[mcp_servers.docs]\nurl = "https://a.example/mcp"\n\n[mcp_servers.docs.http_headers]\nX-Team = "core"\n');
  const entry = (await readTool(context, 'codex-cli')).entries.find(e => e.name === 'docs')!;
  assert.deepEqual(entry.server.headers, { 'X-Team': 'core' }, 'headers in table form are not read, so other tools get the server without them');
}));

test('P3 inline-table Codex server is not duplicated into invalid TOML', () => box(async ({ home, context }) => {
  await fs.writeFile(copilot(home), JSON.stringify({ mcpServers: { docs: { type: 'local', command: 'docs-mcp', tools: ['*'] } } }));
  await fs.writeFile(codex(home), 'model = "gpt-5"\n\n[mcp_servers]\ndocs = { command = "docs-mcp" }\n');
  await applyMcp(context, tools.slice(1), managed('docs'));
  const text = await fs.readFile(codex(home), 'utf8');
  // A second definition of mcp_servers.docs makes the file invalid TOML for Codex.
  assert.ok(!/\[mcp_servers\.docs\]/.test(text), `added a second definition of mcp_servers.docs:\n${text}`);
}));

test('P4 Claude Code recreating .claude.json without servers is not a deletion everywhere', () => box(async ({ home, context }) => {
  const claude = join(home, '.claude.json');
  const servers = { docs: { type: 'stdio', command: 'docs-mcp' }, web: { type: 'stdio', command: 'web-mcp' } };
  await fs.writeFile(claude, JSON.stringify({ numStartups: 3, mcpServers: servers }));
  await applyMcp(context, tools, [...managed('docs'), ...managed('web')], { claudeNow: ['docs', 'web'] });
  assert.ok((await readTool(context, 'codex-cli')).entries.length === 2);
  // Claude Code replaces its file (atomic write) with a fresh one: no missing window.
  await fs.writeFile(`${claude}.new`, JSON.stringify({ numStartups: 1, firstStartTime: 'now' }));
  await fs.rename(`${claude}.new`, claude);
  await applyMcp(context, tools, [], { settleMs: 0 });
  await applyMcp(context, tools, [], { settleMs: 0 });
  const left = (await readTool(context, 'codex-cli')).entries.map(e => e.name);
  assert.deepEqual(left, ['docs', 'web'], `Codex servers removed after Claude reset its file: ${JSON.stringify(left)}`);
}));

test('P5 a symlinked config file stays a symlink after a write', () => box(async ({ home, context }) => {
  const real = join(home, 'dotfiles-config.toml');
  await fs.writeFile(real, 'model = "gpt-5"\n');
  await fs.symlink(real, codex(home));
  await fs.writeFile(copilot(home), JSON.stringify({ mcpServers: { docs: { type: 'local', command: 'docs-mcp' } } }));
  await applyMcp(context, tools.slice(1), managed('docs'));
  const info = await fs.lstat(codex(home));
  assert.ok(info.isSymbolicLink(), `config.toml symlink replaced by a regular file; dotfile target ${await fs.readFile(real, 'utf8').then(t => (t.includes('docs') ? 'updated' : 'NOT updated'))}`);
}));

test('P6 a comment before the next table survives a rewrite of the server', () => box(async ({ home, context }) => {
  await fs.writeFile(copilot(home), JSON.stringify({ mcpServers: { docs: { type: 'local', command: 'A' } } }));
  await fs.writeFile(codex(home), '[mcp_servers.docs]\ncommand = "A"\n\n# Work profile: keep this\n[profiles.work]\nmodel = "o3"\n');
  await applyMcp(context, tools.slice(1), managed('docs'));
  await fs.writeFile(copilot(home), JSON.stringify({ mcpServers: { docs: { type: 'local', command: 'B' } } }));
  await applyMcp(context, tools.slice(1), []);
  const text = await fs.readFile(codex(home), 'utf8');
  assert.match(text, /command = "B"/);
  assert.match(text, /# Work profile/, `comment belonging to the next table was dropped:\n${text}`);
  readTomlTables(text);
}));

test('P7 an MCP pass that hits a write error still syncs the other servers', () => box(async ({ home, context }) => {
  await fs.writeFile(copilot(home), JSON.stringify({ mcpServers: { a: { type: 'local', command: 'A' }, b: { type: 'local', command: 'B' } } }));
  await fs.writeFile(codex(home), '');
  await applyMcp(context, tools.slice(1), [...managed('a'), ...managed('b')]);
  await fs.writeFile(copilot(home), JSON.stringify({ mcpServers: { a: { type: 'local', command: 'A2' }, b: { type: 'local', command: 'B2' } } }));
  await fs.chmod(join(home, '.codex'), 0o555);
  let threw: unknown;
  try { await applyMcp(context, tools.slice(1), []); } catch (error) { threw = error; } finally { await fs.chmod(join(home, '.codex'), 0o755); }
  assert.equal(threw, undefined, `applyMcp threw instead of reporting a held write: ${threw}`);
}));

test('P8 agent frontmatter line ending in --- is not read as the end of frontmatter', () => box(async ({ home, context }) => {
  const claude = join(home, '.claude', 'agents', 'rev.md');
  await fs.writeFile(claude, '---\nname: rev\ndescription: Reviews code ---\nmodel: sonnet\n---\n\nBody\n');
  await applyAgents(context, tools, managed('rev'));
  const toml = await fs.readFile(join(home, '.codex', 'agents', 'rev.toml'), 'utf8').catch(() => '');
  assert.ok(!/model: sonnet/.test(toml), `Claude's frontmatter leaked into the prompt:\n${toml}`);
}));

test('P9 Claude copy waiting for Write now, then edited in Claude: a conflict, not a silent one-sided edit', () => box(async ({ home, context }) => {
  const claude = join(home, '.claude.json');
  const j = (c: string) => JSON.stringify({ mcpServers: { docs: { type: 'stdio', command: c } } });
  await fs.writeFile(claude, j('BASE')); 
  await applyMcp(context, tools, managed('docs'), { claudeNow: ['docs'] });
  await fs.writeFile(copilot(home), JSON.stringify({ mcpServers: { docs: { type: 'local', command: 'COPILOT-EDIT', tools: ['*'] } } }));
  await applyMcp(context, tools, []); // Codex gets it; Claude waits for Write now
  await fs.writeFile(claude, j('CLAUDE-EDIT'));
  const r = await applyMcp(context, tools, []);
  const cmd = async (t: HarnessId) => (await readTool(context, t)).entries[0]?.server.command;
  assert.ok(r.notices?.some(n => n.kind === 'conflict'), 'Copilot edit overwritten as a plain one-sided edit');
}));

