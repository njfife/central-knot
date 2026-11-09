// Reproductions from the Opus fifth check (51a5d32), kept as regressions.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { applyAgents, readAgents } from '../src/agents.ts';
import type { ShareContext } from '../src/share.ts';
import type { HarnessId } from '../src/types.ts';

const tools: HarnessId[] = ['claude-cli', 'copilot-cli', 'codex-cli'];
const md = (prompt = 'Original', extra = '') => `---\nname: reviewer\ndescription: Review\n${extra}---\n\n${prompt}\n`;
async function box() {
  const base = await mkdtemp(join(tmpdir(), 'ck-opus5-'));
  const home = join(base, 'home');
  for (const f of ['.claude', '.copilot', '.codex']) await mkdir(join(home, f, 'agents'), { recursive: true });
  const context: ShareContext = { home, mode: 'custom', read: async () => [], build: 'test', settingsPath: join(base, 'settings.json'), realHome: join(base, 'real') };
  const paths = ['.claude/agents/reviewer.md', '.copilot/agents/reviewer.agent.md', '.codex/agents/reviewer.toml'].map(p => join(home, p));
  return { home, context, paths, clean: () => rm(base, { recursive: true, force: true }) };
}
const manage = [{ key: 'reviewer', managed: true, off: [] as HarnessId[] }];

test('A1 Sync off: Apply all for a tool toggle also spreads a pending edit', async () => {
  const b = await box(); try {
    await writeFile(b.paths[0], md()); await applyAgents(b.context, tools, manage);
    await writeFile(b.paths[1], md('Edited in Copilot while Sync is off'));
    // Page: turn Codex off for this agent, Apply all (Sync off => only)
    const r = await applyAgents(b.context, tools, [{ key: 'reviewer', managed: true, off: ['codex-cli'] }], { only: new Set(['reviewer']) });
    assert.match(await readFile(b.paths[0], 'utf8'), /^Original/m, 'Claude was written with Sync off');
  } finally { await b.clean(); }
});

test('A3 quoted name key in destination frontmatter', async () => {
  const b = await box(); try {
    await writeFile(b.paths[0], md());
    await writeFile(b.paths[1], `---\n"name": reviewer\n"description": Review\n---\n\nOriginal\n`);
    await applyAgents(b.context, tools, manage);
    await writeFile(b.paths[0], md('Edited'));
    const r = await applyAgents(b.context, tools, []);
    const read = await readAgents(b.context, 'copilot-cli');
    assert.equal(read.unreadable.size, 0, 'Copilot file broken: ' + read.problems.join(';'));
  } finally { await b.clean(); }
});
