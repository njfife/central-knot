// Reproductions from the Astra judge of agents (e805d21), kept as regressions.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { agentText, applyAgents, readAgents, restoreAgent } from '../src/agents.ts';
import { readHistory } from '../src/manage.ts';
import { readRecord, saveRecord, syncGate, type ShareContext } from '../src/share.ts';
import type { HarnessId } from '../src/types.ts';

const tools: HarnessId[] = ['claude-cli', 'copilot-cli', 'codex-cli'];
const md = (prompt = 'Original', extra = '') => `---\nname: reviewer\ndescription: Review\n${extra}---\n\n${prompt}\n`;
async function box() {
  const base = await mkdtemp(join(tmpdir(), 'ck-astra-case-'));
  const home = join(base, 'home');
  for (const f of ['.claude', '.copilot', '.codex']) await mkdir(join(home, f, 'agents'), { recursive: true });
  const context: ShareContext = { home, mode: 'custom', read: async () => [], build: 'test', settingsPath: join(base, 'settings.json'), realHome: join(base, 'real') };
  const paths = ['.claude/agents/reviewer.md', '.copilot/agents/reviewer.agent.md', '.codex/agents/reviewer.toml'].map(p => join(home, p));
  return { home, context, paths, clean: () => rm(base, { recursive: true, force: true }) };
}
const manage = [{ key: 'reviewer', managed: true, off: [] }];

test('R1 malformed managed file must not propagate deletion', async () => {
  const b = await box(); try {
    await writeFile(b.paths[0], md()); await applyAgents(b.context, tools, manage);
    await writeFile(b.paths[1], '---\nname: [unfinished\n---\nLocal work');
    await applyAgents(b.context, tools, [], { now: 1000 });
    await applyAgents(b.context, tools, [], { now: 4000 });
    assert.equal(await readFile(b.paths[0], 'utf8').catch(() => 'DELETED'), md());
  } finally { await b.clean(); }
});
test('R3 deletion Restore must recover each destinations own fields', async () => {
  const b = await box(); try {
    await writeFile(b.paths[0], md('Original', 'model: opus\n'));
    await writeFile(b.paths[1], md('Original', 'model: copilot-model\n'));
    await applyAgents(b.context, tools, [{ ...manage[0], use: 'claude-cli' }]);
    await rm(b.paths[0]); await applyAgents(b.context, tools, [], { settleMs: 0 });
    const event = (await readHistory(b.context)).find(e => e.kind === 'deleted')!;
    await restoreAgent(b.context, tools, event.id);
    assert.match(await readFile(b.paths[1], 'utf8'), /model: copilot-model/);
  } finally { await b.clean(); }
});
test('R4 undo must respect stopped one-way copies', async () => {
  const b = await box(); try {
    await writeFile(b.paths[0], md('Original', 'model: opus\n')); await applyAgents(b.context, tools, manage);
    await writeFile(b.paths[1], md('Local only')); await applyAgents(b.context, tools, []);
    await writeFile(b.paths[0], md('Upstream edit', 'model: opus\n')); await applyAgents(b.context, tools, []);
    const event = (await readHistory(b.context)).find(e => e.kind === 'edit')!;
    await restoreAgent(b.context, tools, event.id);
    assert.match(await readFile(b.paths[1], 'utf8'), /Local only/);
  } finally { await b.clean(); }
});
test('R5 old deletion Restore must not overwrite newly managed same-name agent', async () => {
  const b = await box(); try {
    await writeFile(b.paths[0], md()); await applyAgents(b.context, tools, manage);
    await rm(b.paths[1]); await applyAgents(b.context, tools, [], { settleMs: 0 });
    const event = (await readHistory(b.context)).find(e => e.kind === 'deleted')!;
    await writeFile(b.paths[0], md('Unrelated replacement')); await applyAgents(b.context, tools, manage);
    const result = await restoreAgent(b.context, tools, event.id);
    assert.ok(result.stopped, JSON.stringify(result));
  } finally { await b.clean(); }
});
test('R6 deletion must not remove a never-managed different same-name copy', async () => {
  const b = await box(); try {
    await writeFile(b.paths[0], md()); await applyAgents(b.context, tools.slice(0, 2), manage);
    await writeFile(b.paths[2], agentText('codex-cli', { name: 'reviewer', description: 'Review', prompt: 'Unrelated new installation' }));
    await rm(b.paths[1]); await applyAgents(b.context, tools, [], { settleMs: 0 });
    assert.match(await readFile(b.paths[2], 'utf8').catch(() => 'DELETED'), /Unrelated new installation/);
  } finally { await b.clean(); }
});
test('R7 changing tool home to existing empty agents folder is not deletion', async () => {
  const b = await box(); try {
    await writeFile(b.paths[0], md()); await applyAgents(b.context, tools, manage);
    const alternate = join(b.home, 'alternate'); await mkdir(join(alternate, 'agents'), { recursive: true });
    b.context.overrides = { 'codex-cli': alternate };
    await applyAgents(b.context, tools, [], { settleMs: 0 });
    assert.equal(await readFile(b.paths[0], 'utf8').catch(() => 'DELETED'), md());
  } finally { await b.clean(); }
});
test('R8 Restore must respect ownership gate', async () => {
  const b = await box(); try {
    await writeFile(b.paths[0], md()); await applyAgents(b.context, tools, manage);
    await writeFile(b.paths[0], md('Edited')); await applyAgents(b.context, tools, []);
    const event = (await readHistory(b.context)).find(e => e.kind === 'edit')!;
    const { record } = await readRecord(b.home); record!.owner = 'other-build'; await saveRecord(b.home, record!);
    assert.equal((await syncGate(b.context)).state, 'stopped');
    const result = await restoreAgent(b.context, tools, event.id);
    assert.equal(result.writes, 0, JSON.stringify(result));
  } finally { await b.clean(); }
});
test('R10 edit versus deletion must produce resolution notice', async () => {
  const b = await box(); try {
    await writeFile(b.paths[0], md()); await applyAgents(b.context, tools.slice(0, 2), manage);
    await rm(b.paths[1]); await writeFile(b.paths[0], md('Surviving edit'));
    const result = await applyAgents(b.context, tools.slice(0, 2), [], { settleMs: 0 });
    assert.ok(result.notices?.length, JSON.stringify(result));
  } finally { await b.clean(); }
});
test('R11 TOML updating keys must not replace matching text inside prompt', async () => {
  const b = await box(); try {
    const before = 'developer_instructions = """\nname = "reviewer"\nOld prompt\n"""\nname = "reviewer"\ndescription = "Review"\n';
    const next = agentText('codex-cli', { name: 'changed-name', description: 'Review', prompt: 'New prompt\n' }, before);
    await writeFile(b.paths[2], next);
    const actual = (await readAgents(b.context, 'codex-cli')).entries[0].agent;
    assert.deepEqual([actual.name, actual.prompt], ['changed-name', 'New prompt\n']);
  } finally { await b.clean(); }
});
