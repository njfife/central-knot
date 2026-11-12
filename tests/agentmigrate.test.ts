// The agents record from before the library, migrated (src/agentmigrate.ts, run by src/agentstore.ts openLibrary).
// Each fixture is a home as the earlier engine left it: its `agents.json` (format 2), the files it kept under
// `.central-knot/items/agents/`, and the harnesses' own files. For every state that record could hold:
//   after the migration and one pass, every harness file is byte for byte as before, and every content is a version;
//   a second pass writes nothing; and a crash at either step of the migration leaves the old files as they were.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, readFile, readdir, rename, utimes, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { agentHash, parseAgent } from '../src/agentfiles.ts';
import { agentVersion, agentsView } from '../src/agents.ts';
import { placeOf } from '../src/agentrow.ts';
import { sourceWords } from '../src/library.ts';
import { readHistory } from '../src/manage.ts';
import { sha256, type ShareContext } from '../src/share.ts';
import type { HarnessId } from '../src/types.ts';
import { claudeAgent, claudeOwn, codexAgent, fileOf, filesOf, historyActions, itemOf, pass, readOf, sandbox, tools, turnOn, type Box, type Tool } from './agentclicks.ts';

const copilotAgent = (prompt = 'You review code.\nBe brief.\n') => `---\nname: reviewer\ndescription: Reviews code\n---\n\n${prompt}`;
const hashOf = (tool: Tool, text: string) => agentHash(parseAgent(tool, 'reviewer', text)!);
const BRIEF = hashOf('claude-cli', claudeAgent());

/** A copy as the old record named it: where it was, its content, its whole file, and its marks. */
const copy = (box: Box, tool: Tool, text: string, marks: object = {}) => ({ tool, file: fileOf(box, tool), hash: hashOf(tool, text), bytes: sha256(text), ...marks });
/** Writes the old record with one item, "reviewer". */
async function oldRecord(box: Box, item: object) {
  await mkdir(join(box.home, '.central-knot'), { recursive: true });
  await writeFile(join(box.home, '.central-knot/sync.json'), JSON.stringify({ formatVersion: 1, generation: 'g', owner: 'test', items: {} }));
  await writeFile(box.context.settingsPath, JSON.stringify({ homes: { [box.home]: { generation: 'g' } } }));
  await writeFile(join(box.home, '.central-knot/agents.json'), `${JSON.stringify({ formatVersion: 2, items: { reviewer: { name: 'reviewer', off: [], ...item } } }, null, 2)}\n`);
}
/** Keeps a harness's file as the old engine did: under the content's hash, `agent.json` and `<harness>.txt`. */
async function oldKept(box: Box, tool: Tool, text: string) {
  const agent = parseAgent(tool, 'reviewer', text)!, base = join(box.home, '.central-knot/items/agents/reviewer', agentHash(agent));
  await mkdir(base, { recursive: true });
  await writeFile(join(base, `${tool}.txt`), text);
  await writeFile(join(base, 'agent.json'), JSON.stringify({ tool, name: 'reviewer', agent }));
}
const write = async (box: Box, texts: Partial<Record<Tool, string>>) => { for (const [tool, text] of Object.entries(texts)) await writeFile(fileOf(box, tool as Tool), text!); };
/** Every file under the old engine's part of `.central-knot`, with its text: what a migration must leave as it was. */
async function oldFiles(box: Box) {
  const base = join(box.home, '.central-knot'), found: Record<string, string> = { 'agents.json': await readFile(join(base, 'agents.json'), 'utf8') };
  for (const hash of await readdir(join(base, 'items/agents/reviewer')).catch(() => [] as string[])) {
    if (!/^[0-9a-f]{64}$/.test(hash)) continue;
    for (const file of await readdir(join(base, 'items/agents/reviewer', hash))) found[`${hash.slice(0, 6)}/${file}`] = await readFile(join(base, 'items/agents/reviewer', hash, file), 'utf8');
  }
  return found;
}
/** The agent's versions by their prompt's last line, and where each came from. */
async function versions(box: Box) {
  const item = (await itemOf(box))!;
  const line = async (hash: string) => (await agentVersion(box.context, 'reviewer', hash))?.prompt.trim().split('\n').at(-1);
  return (await Promise.all(item.versions.map(async version => `${await line(version.hash)} (${sourceWords(version.from)})${version.hash === item.hash ? ' *' : ''}`))).sort();
}

interface Fixture { name: string; build(box: Box): Promise<void>; /** What the migrated item is: its place, the harnesses kept out, those applied to, and its versions. */ expect: { place: string; except?: Tool[]; applied?: Tool[]; versions: string[]; deleted?: true } | 'found' }

const synced = { state: 'shared', hash: BRIEF, origin: 'claude-cli' };
const fixtures: Fixture[] = [
  { name: 'synced, every copy the synced content; the others receive-only for Claude Code’s own fields',
    async build(box) {
      const texts = { 'claude-cli': claudeAgent(undefined, claudeOwn), 'copilot-cli': copilotAgent(), 'codex-cli': codexAgent() };
      await write(box, texts);
      await oldKept(box, 'claude-cli', texts['claude-cli']);
      await oldRecord(box, { ...synced, copies: [copy(box, 'claude-cli', texts['claude-cli']), copy(box, 'copilot-cli', texts['copilot-cli'], { oneWay: true }), copy(box, 'codex-cli', texts['codex-cli'], { oneWay: true })] });
    },
    expect: { place: 'on', applied: ['claude-cli', 'copilot-cli', 'codex-cli'], versions: ['Be brief. (from before Central Knot kept versions) *'] } },
  { name: 'synced, with a harness left out that holds its own copy',
    async build(box) {
      await write(box, { 'claude-cli': claudeAgent(), 'copilot-cli': copilotAgent(), 'codex-cli': codexAgent('You review code.\nBe quick.\n') });
      await oldKept(box, 'claude-cli', claudeAgent());
      await oldRecord(box, { ...synced, off: ['codex-cli'], copies: [copy(box, 'claude-cli', claudeAgent()), copy(box, 'copilot-cli', copilotAgent())] });
    },
    expect: { place: 'on', except: ['codex-cli'], applied: ['claude-cli', 'copilot-cli'], versions: ['Be brief. (from before Central Knot kept versions) *', 'Be quick. (was in Codex)'] } },
  { name: 'synced, with a receive-only copy that had stopped updating after an edit there',
    async build(box) {
      const edited = copilotAgent('You review code.\nBe exact.\n');
      await write(box, { 'claude-cli': claudeAgent(undefined, claudeOwn), 'copilot-cli': edited, 'codex-cli': codexAgent() });
      await oldKept(box, 'claude-cli', claudeAgent(undefined, claudeOwn));
      await oldRecord(box, { ...synced, copies: [copy(box, 'claude-cli', claudeAgent(undefined, claudeOwn)), copy(box, 'copilot-cli', copilotAgent(), { oneWay: true, stopped: true }), copy(box, 'codex-cli', codexAgent(), { oneWay: true })] });
    },
    expect: { place: 'on', except: ['copilot-cli'], applied: ['claude-cli', 'codex-cli'], versions: ['Be brief. (from before Central Knot kept versions) *', 'Be exact. (was in Copilot CLI)'] } },
  { name: 'synced, with a receive-only copy edited there that no pass had seen yet',
    async build(box) {
      await write(box, { 'claude-cli': claudeAgent(undefined, claudeOwn), 'copilot-cli': copilotAgent(), 'codex-cli': codexAgent('You review code.\nBe exact.\n') });
      await oldKept(box, 'claude-cli', claudeAgent(undefined, claudeOwn));
      await oldRecord(box, { ...synced, copies: [copy(box, 'claude-cli', claudeAgent(undefined, claudeOwn)), copy(box, 'copilot-cli', copilotAgent(), { oneWay: true }), copy(box, 'codex-cli', codexAgent(), { oneWay: true })] });
    },
    expect: { place: 'on', except: ['codex-cli'], applied: ['claude-cli', 'copilot-cli'], versions: ['Be brief. (from before Central Knot kept versions) *', 'Be exact. (was in Codex)'] } },
  { name: 'synced, with a copy that differs and was never on record (it waited for a choice of copy)',
    async build(box) {
      await write(box, { 'claude-cli': claudeAgent(), 'copilot-cli': copilotAgent(), 'codex-cli': codexAgent('You review code.\nBe quick.\n') });
      await oldKept(box, 'claude-cli', claudeAgent());
      await oldRecord(box, { ...synced, copies: [copy(box, 'claude-cli', claudeAgent()), copy(box, 'copilot-cli', copilotAgent())] });
    },
    expect: { place: 'on', except: ['codex-cli'], applied: ['claude-cli', 'copilot-cli'], versions: ['Be brief. (from before Central Knot kept versions) *', 'Be quick. (was in Codex)'] } },
  { name: 'copies kept separate, never synced',
    async build(box) {
      await write(box, { 'claude-cli': claudeAgent(), 'codex-cli': codexAgent('You review code.\nBe quick.\n') });
      // Never synced, so its current version is its latest copy: Codex's, saved after Claude Code's.
      await utimes(fileOf(box, 'codex-cli'), new Date(), new Date(Date.now() + 5000));
      await oldRecord(box, { state: 'dont-share', hash: '', separate: true, copies: [] });
    },
    expect: { place: 'off', versions: ['Be brief. (was in Claude Code)', 'Be quick. (was in Codex) *'] } },
  { name: 'synced once, then turned off: each harness kept its copy, and one was edited since',
    async build(box) {
      await write(box, { 'claude-cli': claudeAgent(), 'copilot-cli': copilotAgent('You review code.\nBe exact.\n'), 'codex-cli': codexAgent() });
      await oldKept(box, 'claude-cli', claudeAgent());
      await oldKept(box, 'copilot-cli', copilotAgent('You review code.\nBe early.\n'));
      await oldRecord(box, { state: 'dont-share', hash: BRIEF, origin: 'claude-cli', copies: [] });
    },
    expect: { place: 'off', versions: ['Be brief. (from before Central Knot kept versions) *', 'Be early. (from before Central Knot kept versions)', 'Be exact. (was in Copilot CLI)'] } },
  { name: 'deleted everywhere, with a removal still owed in one harness and a stopped copy left in another',
    async build(box) {
      await write(box, { 'copilot-cli': copilotAgent('You review code.\nBe exact.\n'), 'codex-cli': codexAgent() });
      await oldKept(box, 'claude-cli', claudeAgent(undefined, claudeOwn));
      await oldKept(box, 'codex-cli', codexAgent());
      await rename(join(box.home, '.codex/agents'), join(box.home, '.codex/agents-away'));
      await oldRecord(box, { state: 'dont-share', hash: BRIEF, deleted: { at: new Date().toISOString(), tool: 'claude-cli', hash: BRIEF },
        copies: [copy(box, 'copilot-cli', copilotAgent(), { oneWay: true, stopped: true }), copy(box, 'codex-cli', codexAgent(), { oneWay: true, status: 'removing', away: true })] });
    },
    expect: { place: 'found', deleted: true, applied: ['codex-cli'], versions: ['Be brief. (from before Central Knot kept versions) *', 'Be exact. (was in Copilot CLI)'] } },
  { name: 'on record but never synced, with nothing kept and no copy left',
    async build(box) { await oldRecord(box, { state: 'dont-share', hash: '', copies: [] }); },
    expect: 'found' },
];

for (const fixture of fixtures) {
  test(`Migration, ${fixture.name}: no harness file changes, every content is a version, and a second pass writes nothing`, async () => {
    const box = await sandbox();
    try {
      await fixture.build(box);
      const before = { harnesses: await filesOf(box), kept: await oldFiles(box) };
      const first = await pass(box);
      assert.deepEqual([first.stopped, first.writes], [undefined, 0], JSON.stringify(first.results));
      assert.deepEqual(await filesOf(box), before.harnesses);
      assert.equal((await pass(box)).writes, 0);
      const item = await itemOf(box);
      if (fixture.expect === 'found') assert.equal(item, undefined);
      else {
        assert.deepEqual([placeOf(item), !!item!.deleted, [...item!.except].sort(), Object.keys(item!.applied).sort(), await versions(box)],
          [fixture.expect.place, !!fixture.expect.deleted, [...(fixture.expect.except ?? [])].sort(), [...(fixture.expect.applied ?? [])].sort(), fixture.expect.versions]);
      }
      // The old record is kept as it was, beside the new one, and so is every file the old engine kept.
      assert.equal(await readFile(join(box.home, '.central-knot/agents.v2.json'), 'utf8'), before.kept['agents.json']);
      assert.deepEqual({ ...await oldFiles(box), 'agents.json': before.kept['agents.json'] }, before.kept);
      assert.equal(JSON.parse(await readFile(join(box.home, '.central-knot/agents.json'), 'utf8')).formatVersion, 3);
    } finally { await box.cleanup(); }
  });
}

test('A crash at either step of the migration leaves the old record and its kept files as they were, and the next pass migrates', async () => {
  for (const step of ['before-replace', 'mid-replace'] as const) {
    const box = await sandbox();
    try {
      await fixtures[2].build(box);
      const before = { harnesses: await filesOf(box), kept: await oldFiles(box) };
      const crashing: ShareContext = { ...box.context, fault: at => { if (at === step) throw new Error(`crash at ${step}`); } };
      await assert.rejects(pass(box, crashing), new RegExp(`crash at ${step}`));
      assert.deepEqual([await oldFiles(box), await filesOf(box)], [before.kept, before.harnesses], step);
      // A reader in between (the Agents page) sees the migrated agent without anything being written.
      assert.equal((await agentsView(box.context, tools)).library?.reviewer?.on, true);
      assert.deepEqual(await oldFiles(box), before.kept);
      assert.equal((await pass(box)).writes, 0);
      assert.deepEqual([(await itemOf(box))!.except, await filesOf(box)], [['copilot-cli'], before.harnesses]);
    } finally { await box.cleanup(); }
  }
});

test('After migration the model takes over: Off then On writes each harness’s kept file back, and a copy left alone is taken in only when asked', async () => {
  const box = await sandbox();
  try {
    await fixtures[2].build(box);
    await pass(box);
    // Copilot CLI's edited copy stays out of sync until its own switch lets it in: its content is a version already, so the
    // current version is written over it.
    const { row, item } = await (await import('./agentclicks.ts')).seen(box);
    assert.deepEqual([row.hashes?.['copilot-cli'] !== item!.hash, item!.except], [true, ['copilot-cli']]);
    const { keepOut, turnOff } = await import('./agentclicks.ts');
    await keepOut(box, 'copilot-cli', false);
    assert.match((await readOf(box, 'copilot-cli'))!, /Be brief\./);
    const before = await filesOf(box);
    await turnOff(box);
    assert.notEqual(await turnOn(box), 'choose');
    assert.deepEqual(await filesOf(box), before);
  } finally { await box.cleanup(); }
});

test('A deleted agent from before the library is restored by its old History entry: every harness it synced to gets its kept file back', async () => {
  const box = await sandbox();
  try {
    await write(box, {});
    const texts = { 'claude-cli': claudeAgent(undefined, claudeOwn), 'copilot-cli': copilotAgent(), 'codex-cli': codexAgent() };
    for (const tool of tools) await oldKept(box, tool as Tool, texts[tool as Tool]);
    await oldRecord(box, { state: 'dont-share', hash: BRIEF, deleted: { at: new Date().toISOString(), tool: 'copilot-cli', hash: BRIEF }, copies: [] });
    const deletion = { id: 'old-deletion', at: new Date().toISOString(), key: 'agent:reviewer', item: 'reviewer', kind: 'deleted', winner: { tool: 'copilot-cli' as HarnessId, hash: BRIEF }, losers: [], orderProved: true, previous: BRIEF };
    await writeFile(join(box.home, '.central-knot/history.json'), JSON.stringify({ events: [deletion] }));
    assert.equal((await pass(box)).writes, 0);
    const actions = await historyActions(box);
    assert.deepEqual(actions.map(action => action.label), ['Restore']);
    await actions[0].run();
    assert.deepEqual(await filesOf(box), texts);
    assert.equal((await readHistory(box.context)).find(event => event.id === 'old-deletion')?.undoneBy !== undefined, true);
  } finally { await box.cleanup(); }
});

test('A record from before agents were rewritten (format 1) carries nothing over, and is kept as a backup', async () => {
  const box = await sandbox();
  try {
    await write(box, { 'claude-cli': claudeAgent() });
    await oldRecord(box, {});
    const old = JSON.stringify({ formatVersion: 1, items: {} });
    await writeFile(join(box.home, '.central-knot/agents.json'), old);
    assert.equal((await pass(box)).writes, 0);
    assert.deepEqual([await itemOf(box), await readFile(join(box.home, '.central-knot/agents.v1.json'), 'utf8')], [undefined, old]);
  } finally { await box.cleanup(); }
});
