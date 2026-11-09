// Reproductions from the Opus fifth check (51a5d32), kept as regressions.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { agentText, applyAgents, readAgents, restoreAgent } from '../src/agents.ts';
import { readHistory } from '../src/manage.ts';
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

test('A2 empty (mid-save) Codex TOML reads as an agent and spreads empties', async () => {
  const b = await box(); try {
    await writeFile(b.paths[2], agentText('codex-cli', { name: 'reviewer', description: 'Review', prompt: 'Original' }));
    await applyAgents(b.context, tools, manage);
    await writeFile(b.paths[2], ''); // editor truncates before writing
    const r = await applyAgents(b.context, tools, []);
    assert.match(await readFile(b.paths[0], 'utf8'), /Original/, 'Claude lost its prompt: ' + await readFile(b.paths[0], 'utf8'));
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

test('A4 agent removed while its tool is off for it: turning the tool back on deletes it everywhere', async () => {
  const b = await box(); try {
    await writeFile(b.paths[0], md()); await applyAgents(b.context, tools, manage);
    await applyAgents(b.context, tools, [{ key: 'reviewer', managed: true, off: ['copilot-cli'] }]);
    await rm(b.paths[1]);
    await applyAgents(b.context, tools, [], { settleMs: 0 });
    const r = await applyAgents(b.context, tools, [{ key: 'reviewer', managed: true, off: [] }], { settleMs: 0 });
    const r2 = await applyAgents(b.context, tools, [], { settleMs: 0 });
    assert.equal(await readFile(b.paths[0], 'utf8').catch(() => 'DELETED'), md());
  } finally { await b.clean(); }
});

test('A5 agent edited while its tool is off: turning it back on overwrites the others with no choice', async () => {
  const b = await box(); try {
    await writeFile(b.paths[0], md()); await applyAgents(b.context, tools, manage);
    await applyAgents(b.context, tools, [{ key: 'reviewer', managed: true, off: ['copilot-cli'] }]);
    await writeFile(b.paths[1], md('Copilot-only experiment'));
    const r = await applyAgents(b.context, tools, [{ key: 'reviewer', managed: true, off: [] }]);
    assert.equal(await readFile(b.paths[0], 'utf8'), md(), 'Claude overwritten');
  } finally { await b.clean(); }
});
