// Reproductions from the Astra confirming check (cceda9e), kept as regressions.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { applyMcp, readTool } from '../src/mcp.ts';
import { readHistory } from '../src/manage.ts';
import { writeFileChecked, type ShareContext } from '../src/share.ts';
import type { HarnessId } from '../src/types.ts';

test('catch-up records overwritten content when Claude was the only destination', async () => {
  const base = await fs.mkdtemp(join(tmpdir(), 'ck-confirm-history-'));
  const home = join(base, 'home');
  const tools: HarnessId[] = ['copilot-cli', 'claude-cli'];
  const json = (command: string) => JSON.stringify({ mcpServers: { docs: { command } } });
  try {
    for (const folder of ['.claude', '.copilot']) await fs.mkdir(join(home, folder), { recursive: true });
    const context: ShareContext = { home, mode: 'custom', read: async () => [], build: 'test', settingsPath: join(base, 'settings.json'), realHome: join(base, 'real') };
    const copilot = join(home, '.copilot/mcp-config.json');
    await fs.writeFile(copilot, json('A'));
    await fs.writeFile(join(home, '.claude.json'), json('A'));
    await applyMcp(context, tools, [{ key: 'docs', managed: true, off: [] }]);
    const previous = (await readTool(context, 'claude-cli')).entries[0].hash;
    await fs.writeFile(copilot, json('B'));
    await applyMcp(context, tools, []);
    await applyMcp(context, tools, [], { claudeNow: ['docs'] });
    await applyMcp(context, tools, []);
    assert.equal((await readTool(context, 'claude-cli')).entries[0].server.command, 'B');
    const history = await readHistory(context);
    assert.ok(history.some(event => event.kind === 'edit' && event.previous === previous), JSON.stringify(history));
    assert.ok(!history.some(event => event.winner?.tool === 'claude-cli' && event.losers.some(loser => loser.tool === 'claude-cli')), 'no made-up edit blames Claude Code');
  } finally { await fs.rm(base, { recursive: true, force: true }); }
});

for (const failBackup of [false, true]) {
  test(`EEXIST preserves whole original file, backup rename failure=${failBackup}`, async () => {
    const base = await fs.mkdtemp(join(tmpdir(), 'ck-confirm-race-'));
    const path = join(base, 'settings.json');
    const original = '{"unrelated":"original-value","mcpServers":{}}';
    const saved = '{"mcpServers":{}}';
    const originalLink = fs.link;
    const originalRename = fs.rename;
    try {
      await fs.writeFile(path, original);
      fs.link = async (source, destination) => {
        if (String(destination) === path) await fs.writeFile(path, saved);
        return originalLink(source, destination);
      };
      fs.rename = async (source, destination) => {
        if (failBackup && String(destination).endsWith('.bak')) throw Object.assign(new Error('backup rename failed'), { code: 'EACCES' });
        return originalRename(source, destination);
      };
      syncBuiltinESMExports();
      await assert.rejects(writeFileChecked(path, 'replacement', original), { code: 'CK_CHANGED' });
      assert.equal(await fs.readFile(path, 'utf8'), saved);
      const names = await fs.readdir(base);
      const contents = await Promise.all(names.map(name => fs.readFile(join(base, name), 'utf8')));
      assert.ok(contents.includes(original), `Original lost; remaining files: ${names.join(', ')}`);
    } finally {
      fs.link = originalLink;
      fs.rename = originalRename;
      syncBuiltinESMExports();
      await fs.rm(base, { recursive: true, force: true });
    }
  });
}
