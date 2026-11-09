// Reproductions from the Opus fifth check (51a5d32), kept as regressions.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fsp from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
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
const copilot = (cmd: string) => JSON.stringify({ mcpServers: { tool: { type: 'local', command: cmd, tools: ['*'] } } }, null, 2);

test('M1 Sync off: Apply all toggling a tool also spreads a pending MCP edit', async () => {
  const { applyMcp } = await import('../src/mcp.ts');
  const box = await sandbox(); try {
    await writeFile(join(box.home, '.copilot/mcp-config.json'), copilot('a'));
    await applyMcp(box.context, tools, [{ key: 'tool', managed: true, off: ['claude-cli'] }]);
    await writeFile(join(box.home, '.copilot/mcp-config.json'), copilot('edited-while-off'));
    const r = await applyMcp(box.context, tools, [{ key: 'tool', managed: true, off: ['claude-cli'] }], { only: new Set(['tool']) });
    assert.ok(!(await readFile(join(box.home, '.codex/config.toml'), 'utf8')).includes('edited-while-off'), 'Codex written with Sync off');
  } finally { await box.cleanup(); }
});

test('M2 an edit saved during a pass becomes the baseline and is overwritten next pass with no History', async () => {
  const box = await sandbox();
  const copilotPath = join(box.home, '.copilot/mcp-config.json');
  const original = fsp.readFile;
  try {
    const { applyMcp } = await import('../src/mcp.ts');
    const { readHistory } = await import('../src/manage.ts');
    await writeFile(copilotPath, copilot('a'));
    await applyMcp(box.context, tools, [{ key: 'tool', managed: true, off: ['claude-cli'] }]);
    const toml = await readFile(join(box.home, '.codex/config.toml'), 'utf8');
    await writeFile(join(box.home, '.codex/config.toml'), toml.replace('command = "a"', 'command = "b"'));
    let reads = 0;
    (fsp as any).readFile = async (path: any, ...rest: any[]) => {
      if (String(path) === copilotPath && ++reads === 2) await original.call(fsp, path, 'utf8').then(() => fsp.writeFile(copilotPath, copilot('USER-EDIT')));
      return (original as any).call(fsp, path, ...rest);
    };
    syncBuiltinESMExports();
    const r1 = await applyMcp(box.context, tools, []);
    (fsp as any).readFile = original; syncBuiltinESMExports();
    const r2 = await applyMcp(box.context, tools, []);
    const now = JSON.parse(await readFile(copilotPath, 'utf8')).mcpServers.tool.command;
    const hist = (await readHistory(box.home)).map(e => `${e.kind}:${e.losers.map(l => l.tool).join(',')}`);
    assert.equal(now, 'USER-EDIT');
  } finally { (fsp as any).readFile = original; syncBuiltinESMExports(); await box.cleanup(); }
});

test('M3 MCP entry removed while its tool is off: turning it back on deletes it everywhere', async () => {
  const { applyMcp } = await import('../src/mcp.ts');
  const box = await sandbox(); try {
    await writeFile(join(box.home, '.copilot/mcp-config.json'), copilot('a'));
    await applyMcp(box.context, tools, [{ key: 'tool', managed: true, off: ['claude-cli'] }]);
    await applyMcp(box.context, tools, [{ key: 'tool', managed: true, off: ['claude-cli', 'codex-cli'] }]);
    await writeFile(join(box.home, '.codex/config.toml'), '');
    await applyMcp(box.context, tools, [{ key: 'tool', managed: true, off: ['claude-cli'] }], { settleMs: 0 });
    const r = await applyMcp(box.context, tools, [], { settleMs: 0 });
    assert.ok((await readFile(join(box.home, '.copilot/mcp-config.json'), 'utf8')).includes('"tool"'), 'Copilot entry deleted');
  } finally { await box.cleanup(); }
});
