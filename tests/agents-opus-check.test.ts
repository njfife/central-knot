// Reproductions from the Opus judge of agents (e805d21), kept as regressions.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { applyAgents, restoreAgent } from '../src/agents.ts';
import { readHistory } from '../src/manage.ts';
import type { ShareContext } from '../src/share.ts';
import type { HarnessId } from '../src/types.ts';
const tools: HarnessId[] = ['claude-cli', 'copilot-cli', 'codex-cli'];
async function sandbox() {
  const base = await realpath(await mkdtemp(join(tmpdir(), 'ck-judge-')));
  const home = join(base, 'home');
  for (const f of ['.claude/agents', '.copilot/agents', '.codex/agents']) await mkdir(join(home, f), { recursive: true });
  const context: ShareContext = { home, mode: 'custom', read: async () => [], build: 'test', settingsPath: join(base, 'settings.json'), realHome: join(base, 'real') };
  return { home, context, cleanup: () => rm(base, { recursive: true, force: true }) };
}
const md = (prompt: string, extra = '') => `---\nname: reviewer\ndescription: Reviews code\n${extra}---\n\n${prompt}`;
const rd = (h: string, p: string) => readFile(join(h, p), 'utf8');

test('B: Restore of a deletion is refused because a stopped one-way copy exists', async () => {
  const b = await sandbox();
  try {
    await writeFile(join(b.home, '.claude/agents/reviewer.md'), md('Prompt.\n', 'tools: Read\n'));
    await applyAgents(b.context, tools, [{ key: 'reviewer', managed: true, off: [] }]);
    const cp = await rd(b.home, '.copilot/agents/reviewer.agent.md');
    await writeFile(join(b.home, '.copilot/agents/reviewer.agent.md'), cp.replace('Prompt.', 'Local.'));
    await applyAgents(b.context, tools, []);
    await rm(join(b.home, '.claude/agents/reviewer.md'));
    await applyAgents(b.context, tools, [], { now: 1, settleMs: 2000 });
    const d = await applyAgents(b.context, tools, [], { now: 5000, settleMs: 2000 });
    const ev = (await readHistory(b.home)).find(e => e.kind === 'deleted')!;
    const r = await restoreAgent(b.context, tools, ev.id);
    assert.equal(r.stopped, undefined, 'Restore refused');
  } finally { await b.cleanup(); }
});
