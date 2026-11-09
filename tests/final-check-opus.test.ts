// Reproduction from the Opus final check (1999d87), kept as a regression.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { applyMcp, restoreMcp } from '../src/mcp.ts';
import { readHistory } from '../src/manage.ts';
import type { ShareContext } from '../src/share.ts';
import type { HarnessId } from '../src/types.ts';
const tools: HarnessId[] = ['claude-cli', 'copilot-cli', 'codex-cli'];
test('Restore of a deletion made in Codex keeps Codex enabled = false (DEL-03)', async () => {
  const base = await fs.mkdtemp(join(tmpdir(), 'ck-final-'));
  const home = join(base, 'home');
  for (const n of ['.claude', '.copilot', '.codex']) await fs.mkdir(join(home, n), { recursive: true });
  const context: ShareContext = { home, mode: 'custom', read: async () => [], build: 'test', settingsPath: join(base, 's.json'), realHome: join(base, 'real') };
  const codex = join(home, '.codex', 'config.toml');
  await fs.writeFile(join(home, '.copilot', 'mcp-config.json'), JSON.stringify({ mcpServers: { docs: { type: 'local', command: 'echo', args: ['v1'], tools: ['*'] } } }, null, 2));
  await applyMcp(context, tools, [{ key: 'docs', managed: true, off: [] }]);
  // Nathan disables it in Codex.
  await fs.writeFile(codex, (await fs.readFile(codex, 'utf8')).replace('args = ["v1"]\n', 'args = ["v1"]\nenabled = false\n'));
  await applyMcp(context, tools, []);
  // Deleted in Codex.
  await fs.writeFile(codex, '[mcp_servers.other]\ncommand = "true"\n');
  await applyMcp(context, tools, [], { now: 1, settleMs: 0 });
  const r = await applyMcp(context, tools, [], { now: 10, settleMs: 0 });
  const del = (await readHistory(home)).find(e => e.kind === 'deleted')!;
  assert.ok(del, JSON.stringify(r));
  await restoreMcp(context, tools, del.id);
  const text = await fs.readFile(codex, 'utf8');
  await fs.rm(base, { recursive: true, force: true });
  assert.match(text, /enabled = false/, `Codex came back enabled:\n${text}`);
});
