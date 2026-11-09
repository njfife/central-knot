// Reproductions from the Astra seventh check (0024bce), kept as regressions.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { applyMcp, readTool, restoreMcp } from '../src/mcp.ts';
import { readHistory } from '../src/manage.ts';
import type { ShareContext } from '../src/share.ts';
import type { HarnessId } from '../src/types.ts';

const tools: HarnessId[] = ['copilot-cli', 'codex-cli'];
const managed = (key = 'docs') => [{ key, managed: true, off: [] as HarnessId[] }];
const json = (command: string) => JSON.stringify({ mcpServers: { docs: { command } } });
async function box(run: (context: ShareContext, copilot: string, codex: string) => Promise<void>) {
  const base = await fs.mkdtemp(join(tmpdir(), 'ck-astra7-case-'));
  const home = join(base, 'home');
  for (const folder of ['.claude', '.copilot', '.codex']) await fs.mkdir(join(home, folder), { recursive: true });
  const context: ShareContext = { home, mode: 'custom', read: async () => [], build: 'test', settingsPath: join(base, 'settings.json'), realHome: join(base, 'real') };
  try { await run(context, join(home, '.copilot/mcp-config.json'), join(home, '.codex/config.toml')); }
  finally { await fs.rm(base, { recursive: true, force: true }); }
}
function validToml(text: string) {
  const parsed = spawnSync('python3', ['-c', 'import sys,tomllib; tomllib.loads(sys.stdin.read())'], { input: text, encoding: 'utf8' });
  // An independent TOML parser (Python 3.11+); where none is installed (the Mac's Python 3.9), this one check is skipped.
  if (/No module named 'tomllib'|ENOENT/.test(`${parsed.stderr ?? ''}${parsed.error?.message ?? ''}`)) return;
  assert.equal(parsed.status, 0, `${parsed.stderr}\n${text}`);
}

for (const [name, initial] of [
  ['docs', 'model="gpt-5"\nmcp_servers = { docs = { command = "BASE" } }\n'],
  ['docs.v2', '[mcp_servers]\n"docs.v2" = { command = "BASE" }\n'],
]) {
  test(`R1 preserve valid inline Codex server ${name}`, () => box(async (context, copilot, codex) => {
    validToml(initial);
    await fs.writeFile(codex, initial);
    await fs.writeFile(copilot, JSON.stringify({ mcpServers: { [name]: { command: 'BASE' } } }));
    await applyMcp(context, tools, managed(name));
    validToml(await fs.readFile(codex, 'utf8'));
  }));
}

test('R2 dotted env fields are preserved across tools', () => box(async (context, copilot, codex) => {
  await fs.writeFile(codex, '[mcp_servers.docs]\ncommand="BASE"\nenv.REGION="west"\n');
  await applyMcp(context, tools, managed());
  assert.deepEqual((await readTool(context, 'copilot-cli')).entries[0]?.server.env, { REGION: 'west' });
}));

test('R2 dotted env remains valid after an env edit elsewhere', () => box(async (context, copilot, codex) => {
  await fs.writeFile(codex, '[mcp_servers.docs]\ncommand="BASE"\nenv.REGION="west"\n');
  await applyMcp(context, tools, managed());
  await fs.writeFile(copilot, JSON.stringify({ mcpServers: { docs: { command: 'BASE', env: { REGION: 'east' } } } }));
  await applyMcp(context, tools, []);
  validToml(await fs.readFile(codex, 'utf8'));
}));

test('R3 null mcpServers must not delete the other copies', () => box(async (context, copilot, codex) => {
  await fs.writeFile(copilot, json('BASE'));
  await applyMcp(context, tools, managed());
  await fs.writeFile(copilot, '{"mcpServers":null}');
  await applyMcp(context, tools, [], { now: 1000 });
  await applyMcp(context, tools, [], { now: 4000 });
  assert.equal((await readTool(context, 'codex-cli')).entries[0]?.server.command, 'BASE');
}));

test('R4 symlink target recovers after death in the checked write', () => box(async (context, copilot, codex) => {
  const target = join(context.home, 'dotfiles/config.toml');
  await fs.mkdir(join(context.home, 'dotfiles'));
  await fs.writeFile(target, 'model="gpt-5"\n[mcp_servers.docs]\ncommand="BASE"\n');
  await fs.symlink(target, codex);
  await fs.writeFile(copilot, json('BASE'));
  await applyMcp(context, tools, managed());
  await fs.writeFile(copilot, json('EDIT'));
  const script = `import fs from 'node:fs/promises';import {syncBuiltinESMExports} from 'node:module';import {applyMcp} from './src/mcp.ts';
    const original=fs.link;fs.link=async(from,to)=>{if(String(to)===process.env.CK_TARGET)process.exit(73);return original(from,to);};syncBuiltinESMExports();
    const context=JSON.parse(process.env.CK_CONTEXT);context.read=async()=>[];await applyMcp(context,['copilot-cli','codex-cli'],[]);`;
  const child = spawnSync(process.execPath, ['--input-type=module', '-e', script], { cwd: process.cwd(), env: { ...process.env, CK_TARGET: await fs.realpath(target), CK_CONTEXT: JSON.stringify(context) }, encoding: 'utf8' });
  assert.equal(child.status, 73, child.stderr);
  await applyMcp(context, tools, [], { now: 1000 });
  await applyMcp(context, tools, [], { now: 4000 });
  assert.equal((await readTool(context, 'codex-cli')).exists, true, `Broken link persists; dotfiles contains ${await fs.readdir(join(context.home, 'dotfiles'))}`);
  assert.ok((await fs.lstat(codex)).isSymbolicLink(), 'config.toml link replaced by a regular file');
}));

test('R5 historical native MCP fields are immutable per event', () => box(async (context, copilot, codex) => {
  await fs.writeFile(copilot, json('A'));
  await fs.writeFile(codex, '[mcp_servers.docs]\ncommand="A"\nenabled=false\n');
  await applyMcp(context, tools, managed());
  await fs.writeFile(copilot, json('B'));
  await applyMcp(context, tools, []);
  const firstEdit = (await readHistory(context.home)).find(event => event.kind === 'edit')!;
  await fs.writeFile(copilot, json('A'));
  await applyMcp(context, tools, []);
  await fs.writeFile(codex, '[mcp_servers.docs]\ncommand="A"\nenabled=true\n');
  await fs.writeFile(copilot, json('C'));
  await applyMcp(context, tools, []);
  await restoreMcp(context, tools, firstEdit.id);
  assert.match(await fs.readFile(codex, 'utf8'), /enabled\s*=\s*false/, 'Undo A-to-B must recover A disabled, not the later A enabled');
}));

test('R6 pending removal must not follow a moved Claude config root', () => box(async (context, copilot, codex) => {
  const all: HarnessId[] = ['claude-cli', ...tools];
  await fs.writeFile(join(context.home, '.claude.json'), json('BASE'));
  await applyMcp(context, all, managed());
  await fs.writeFile(copilot, '{"mcpServers":{}}');
  await applyMcp(context, all, [], { settleMs: 0 });
  const alternate = join(context.home, 'alternate-claude');
  await fs.mkdir(alternate);
  await fs.writeFile(join(alternate, '.claude.json'), json('BASE'));
  await applyMcp({ ...context, overrides: { 'claude-cli': alternate } }, all, [], { claudeNow: ['docs'] });
  assert.equal((await readTool({ ...context, overrides: { 'claude-cli': alternate } }, 'claude-cli')).entries[0]?.server.command, 'BASE');
}));
