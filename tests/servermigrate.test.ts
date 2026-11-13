// The MCP record from before the library made into items (servermigrate.ts), on a fixture home holding every state the old
// record can: after the migration and one pass every settings file is byte for byte as it was and every distinct content is a
// version; a second pass writes nothing; the old record is kept as mcp.v1.json; a crash at each step of writing it leaves the
// old files as they were; and History's entries from before stay listed, offering only what the library can still do.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { appendHistory, readHistory } from '../src/history.ts';
import { libraryAction, libraryEntry } from '../src/historyactions.ts';
import { readTool, serverHash, type NeutralServer } from '../src/mcp.ts';
import { applyServers, restoreServer, serversView, writeToClaude } from '../src/servers.ts';
import type { ShareContext } from '../src/share.ts';
import type { HarnessId, HistoryEvent } from '../src/types.ts';

const all: HarnessId[] = ['claude-cli', 'copilot-cli', 'codex-cli', 'pi-cli', 'opencode-cli'];
/** The tools this home's sync manages (OpenCode is there, and not managed). */
const managed: HarnessId[] = ['claude-cli', 'copilot-cli', 'codex-cli', 'pi-cli'];
const FILES: Record<HarnessId, string> = {
  'claude-cli': '.claude.json', 'copilot-cli': '.copilot/mcp-config.json', 'codex-cli': '.codex/config.toml', 'pi-cli': '.pi/agent/mcp.json', 'opencode-cli': '.config/opencode/opencode.json',
};
const server = (command: string): NeutralServer => ({ transport: 'stdio', command });
const H = (command: string) => serverHash(server(command));

async function fixture() {
  const base = await realpath(await mkdtemp(join(tmpdir(), 'ck-servermigrate-')));
  const home = join(base, 'home');
  for (const folder of ['.claude', '.copilot', '.codex', '.pi/agent', '.config/opencode', '.central-knot']) await mkdir(join(home, folder), { recursive: true });
  const context: ShareContext = { home, mode: 'custom', read: async () => [], build: 'test', settingsPath: join(base, 'settings.json'), realHome: join(base, 'real') };
  const store = join(home, '.central-knot', 'items', 'mcp');
  const keep = async (name: string, command: string, own: Partial<Record<HarnessId, Record<string, unknown>>> = {}) => {
    await mkdir(join(store, name, H(command)), { recursive: true });
    await writeFile(join(store, name, `${H(command)}.json`), JSON.stringify(server(command)));
    for (const [tool, extras] of Object.entries(own)) await writeFile(join(store, name, H(command), `${tool}.json`), JSON.stringify({ extras }));
  };
  // A settled home, as the earlier engine left it: what each tool's settings hold. OpenCode is not managed here.
  await writeFile(join(home, FILES['claude-cli']), `${JSON.stringify({ numStartups: 2, mcpServers: { synced: { type: 'stdio', command: 'S', timeout: 30 }, behind: { type: 'stdio', command: 'OLD' }, leftout: { type: 'stdio', command: 'L' }, collide: { type: 'stdio', command: 'C' }, gone: { type: 'stdio', command: 'G' } } }, null, 2)}\n`);
  await writeFile(join(home, FILES['codex-cli']), 'model = "x"\n\n[mcp_servers.synced]\ncommand = "S"\nenabled = false\n\n[mcp_servers.behind]\ncommand = "NEW"\n\n[mcp_servers.leftout]\ncommand = "MINE"\n\n[mcp_servers.collide]\ncommand = "C"\n\n[mcp_servers.alone]\ncommand = "A"\n');
  await writeFile(join(home, FILES['pi-cli']), `${JSON.stringify({ mcpServers: { synced: { command: 'S' }, behind: { command: 'NEW' }, leftout: { command: 'L' }, collide: { command: 'OTHER' }, separate: { command: 'P1' } } }, null, 2)}\n`);
  await writeFile(join(home, FILES['opencode-cli']), '{\n  "mcp": {\n    "separate": { "type": "local", "command": ["P2"] }\n  }\n}\n');
  // Copilot's file is missing: each copy recorded there was away at the old engine's last look.
  const file = (tool: HarnessId) => join(home, FILES[tool]);
  const copy = (tool: HarnessId, command: string, more: object = {}) => ({ tool, hash: H(command), file: file(tool), ...more });
  const away = (command: string) => copy('copilot-cli', command, { away: true });
  const items = {
    synced: { state: 'shared', off: [], hash: H('S'), copies: [copy('claude-cli', 'S'), copy('codex-cli', 'S'), copy('pi-cli', 'S'), away('S')], missingSince: { 'pi-cli': 1 } },
    // Claude Code behind, waiting for Write now; a content a pass displaced before it stopped.
    behind: { state: 'shared', off: [], hash: H('NEW'), copies: [copy('claude-cli', 'OLD'), copy('codex-cli', 'NEW'), copy('pi-cli', 'NEW'), away('NEW')], displaced: [{ tool: 'claude-cli', hash: H('D') }] },
    leftout: { state: 'shared', off: ['codex-cli'], hash: H('L'), copies: [copy('claude-cli', 'L'), copy('pi-cli', 'L'), away('L')] },
    // Pi's entry differs and was never on record: the earlier engine held for a choice of copy.
    collide: { state: 'shared', off: [], hash: H('C'), copies: [copy('claude-cli', 'C'), copy('codex-cli', 'C'), away('C')] },
    gone: { state: 'dont-share', off: [], hash: H('G'), copies: [copy('claude-cli', 'G', { status: 'removing' })], deleted: { at: '2026-11-01T00:00:00.000Z', tool: 'copilot-cli', hash: H('G') } },
    separate: { state: 'dont-share', off: [], hash: '', copies: [], separate: true },
  };
  await writeFile(join(home, '.central-knot', 'mcp.json'), JSON.stringify({ formatVersion: 1, items }));
  await keep('synced', 'S', { 'codex-cli': { enabled: 'enabled = false' }, 'claude-cli': { timeout: 30 }, 'copilot-cli': { tools: ['search'] } });
  await keep('behind', 'OLD'); await keep('behind', 'NEW'); await keep('behind', 'D');
  await keep('leftout', 'L'); await keep('collide', 'C'); await keep('gone', 'G');
  // This home is synced by this build already: the sync record, and this app's memory of it.
  await writeFile(join(home, '.central-knot/sync.json'), JSON.stringify({ formatVersion: 2, generation: 'g', owner: 'test', tools: managed }));
  await writeFile(context.settingsPath, JSON.stringify({ homes: { [home]: { generation: 'g' } } }));
  const files = async () => Object.fromEntries(await Promise.all(all.map(async tool => [tool, await readFile(file(tool), 'utf8').catch(() => undefined)] as const)));
  return { home, context, files, cleanup: () => rm(base, { recursive: true, force: true }) };
}

test('Every state the old MCP record holds becomes its item: after one pass every settings file is as it was, every content is a version, and a second pass writes nothing', async () => {
  const box = await fixture();
  try {
    const before = await box.files();
    const oldRecord = await readFile(join(box.home, '.central-knot/mcp.json'), 'utf8');
    const first = await applyServers(box.context, managed, []);
    assert.deepEqual(first.results.filter(result => result.outcome === 'written' || result.outcome === 'removed'), [], JSON.stringify(first.results));
    assert.deepEqual(await box.files(), before, 'no settings file changes because of the migration');
    assert.equal(await readFile(join(box.home, '.central-knot/mcp.v1.json'), 'utf8'), oldRecord, 'the old record is kept as it was');
    // The record as the pass left it (the page's look writes a file away for longer than the settle window afresh, in memory).
    const view = await serversView(box.context, managed), items = JSON.parse(await readFile(join(box.home, '.central-knot/mcp.json'), 'utf8')).items as typeof view.library;
    const of = (key: string) => [items[key]?.on, items[key]?.hash, items[key]?.except, items[key]?.applied, !!items[key]?.deleted];
    // Synced: On at its content, each recorded copy applied (the away one too); a tool's own fields kept for it.
    assert.deepEqual(of('synced'), [true, H('S'), [], { 'claude-cli': H('S'), 'codex-cli': H('S'), 'pi-cli': H('S'), 'copilot-cli': H('S') }, false]);
    assert.deepEqual(Object.keys(items.synced.own).sort(), ['claude-cli', 'codex-cli', 'copilot-cli', 'pi-cli'], 'the own fields kept before, and the pass keeps each tool’s as it reads it');
    // Claude Code behind: still owed the write, which waits for Write to Claude Code; the displaced content is a version.
    assert.deepEqual(of('behind'), [true, H('NEW'), [], { 'claude-cli': H('OLD'), 'codex-cli': H('NEW'), 'pi-cli': H('NEW'), 'copilot-cli': H('NEW') }, false]);
    assert.deepEqual(view.items.find(item => item.key === 'behind')?.waits, ['claude-cli']);
    assert.deepEqual(items.behind.versions.map(version => version.hash).sort(), [H('D'), H('NEW'), H('OLD')].sort());
    // Left out of Codex: kept out, Codex's own entry left alone.
    assert.deepEqual(of('leftout'), [true, H('L'), ['codex-cli'], { 'claude-cli': H('L'), 'pi-cli': H('L'), 'copilot-cli': H('L') }, false]);
    // A differing entry never on record (Pi's collide): that tool kept out, its entry a version.
    assert.deepEqual(of('collide'), [true, H('C'), ['pi-cli'], { 'claude-cli': H('C'), 'codex-cli': H('C'), 'copilot-cli': H('C') }, false]);
    assert.ok(items.collide.versions.some(version => version.hash === H('OTHER') && version.from.how === 'was-in'));
    // Deleted, with Claude Code's removal still owed: a tombstone, the removal applied (it waits for Write to Claude Code).
    assert.deepEqual(of('gone'), [true, H('G'), [], { 'claude-cli': H('G') }, true]);
    assert.deepEqual(view.items.find(item => item.key === 'gone')?.waits, ['claude-cli']);
    // Kept separate: not in the library, every entry found as it is.
    assert.equal(items.separate, undefined);
    // A server Codex has that was never on record is found.
    assert.equal(items.alone, undefined);
    assert.ok(view.items.some(item => item.key === 'alone' && !item.on));
    const second = await applyServers(box.context, managed, []);
    assert.equal(second.writes, 0, JSON.stringify(second.results));
    assert.deepEqual(await box.files(), before);
    // Copilot's file away past the settle window: written afresh, each entry with the own fields kept for it before.
    await applyServers(box.context, managed, [], { now: Date.now() + 1e6 });
    const copilot = (await readTool(box.context, 'copilot-cli')).entries.find(entry => entry.name === 'synced');
    assert.deepEqual([copilot?.server.command, copilot?.extras], ['S', { tools: ['search'] }]);
  } finally { await box.cleanup(); }
});

test('A crash while the migration writes leaves the old record and every settings file as they were; the next pass finishes it', async () => {
  for (const step of ['before-replace', 'mid-replace']) {
    const box = await fixture();
    try {
      const before = await box.files(), oldRecord = await readFile(join(box.home, '.central-knot/mcp.json'), 'utf8');
      await assert.rejects(applyServers({ ...box.context, fault: at => { if (at === step) throw new Error('crash'); } }, managed, []), /crash/);
      assert.deepEqual([await readFile(join(box.home, '.central-knot/mcp.json'), 'utf8'), await box.files()], [oldRecord, before], step);
      await applyServers(box.context, managed, []);
      assert.equal(JSON.parse(await readFile(join(box.home, '.central-knot/mcp.json'), 'utf8')).formatVersion, 2, step);
      assert.deepEqual(await box.files(), before, step);
    } finally { await box.cleanup(); }
  }
});

test('History’s MCP entries from before the library stay listed and offer only what the library can still do: Undo write is Make current, Undo add is nothing', async () => {
  const box = await fixture();
  try {
    const event = (fields: Partial<HistoryEvent>): HistoryEvent => ({ id: fields.kind!, at: '2026-11-01T00:00:00.000Z', key: 'mcp:behind', item: 'behind', losers: [], orderProved: true, ...fields }) as HistoryEvent;
    await appendHistory(box.context, [
      event({ kind: 'written', winner: { tool: 'claude-cli', hash: H('NEW') }, previous: H('OLD'), losers: [{ tool: 'claude-cli', hash: H('OLD') }] }),
      event({ kind: 'added', losers: [{ tool: 'codex-cli', hash: H('NEW') }] }),
      event({ id: 'deleted', key: 'mcp:gone', item: 'gone', kind: 'deleted', winner: { tool: 'copilot-cli', hash: H('G') }, previous: H('G') }),
      // Named as written, before the library: its key is the name's (library.ts itemKey).
      event({ id: 'edit', key: 'mcp:Behind', item: 'Behind', kind: 'edit', winner: { tool: 'codex-cli', hash: H('NEW') }, previous: H('OLD') }),
    ]);
    await applyServers(box.context, managed, []);
    const items = (await serversView(box.context, managed)).library, history = await readHistory(box.context);
    // Each entry's item as History's page finds it (historyactions.ts libraryEntry).
    const offered = Object.fromEntries(history.map(entry => [entry.kind, libraryAction(entry, items[libraryEntry(entry)!.key])?.label]));
    assert.deepEqual(offered, { written: 'Undo', added: undefined, deleted: 'Restore', edit: 'Undo' });
    assert.equal((await restoreServer(box.context, managed, 'edit')).stopped, undefined, 'an entry naming the server as written runs its action');
    assert.equal((await serversView(box.context, managed)).library.behind.hash, H('OLD'));
    assert.deepEqual(libraryAction(history.find(entry => entry.kind === 'written')!, items.behind)?.change.version, H('OLD'), 'its Undo makes the entry Claude Code had current again');
    assert.equal((await readTool(box.context, 'claude-cli')).entries.find(entry => entry.name === 'gone')?.server.command, 'G');
  } finally { await box.cleanup(); }
});

test('An edit not spread yet is taken in by the first pass; a removal owed for an entry changed since, or a copy in a settings file no longer used, applies nothing', async () => {
  const box = await fixture();
  try {
    const record = JSON.parse(await readFile(join(box.home, '.central-knot/mcp.json'), 'utf8'));
    const file = (tool: HarnessId) => join(box.home, FILES[tool]);
    const copy = (tool: HarnessId, command: string, more: object = {}) => ({ tool, hash: H(command), file: file(tool), ...more });
    // pending: synced at P everywhere, then edited in Codex (P2) before the earlier engine's next pass.
    record.items.pending = { state: 'shared', off: [], hash: H('P'), copies: [copy('claude-cli', 'P'), copy('codex-cli', 'P'), copy('pi-cli', 'P'), copy('copilot-cli', 'P', { away: true })] };
    // changed: deleted, its removal owed in Claude Code, whose entry was edited since (the earlier engine let it be).
    record.items.changed = { state: 'dont-share', off: [], hash: H('K'), copies: [copy('claude-cli', 'K', { status: 'removing' })], deleted: { at: '2026-11-01T00:00:00.000Z', tool: 'pi-cli', hash: H('K') } };
    // moved: Claude Code's copy recorded in a settings file it no longer uses; its entry in the one it uses differs.
    record.items.moved = { state: 'shared', off: [], hash: H('M'), copies: [{ tool: 'claude-cli', hash: H('M'), file: '/elsewhere/.claude.json' }, copy('codex-cli', 'M'), copy('pi-cli', 'M'), copy('copilot-cli', 'M', { away: true })] };
    await writeFile(join(box.home, '.central-knot/mcp.json'), JSON.stringify(record));
    for (const [name, command] of [['pending', 'P'], ['changed', 'K'], ['moved', 'M']]) {
      await mkdir(join(box.home, '.central-knot/items/mcp', name), { recursive: true });
      await writeFile(join(box.home, '.central-knot/items/mcp', name, `${H(command)}.json`), JSON.stringify(server(command)));
    }
    const claude = JSON.parse(await readFile(file('claude-cli'), 'utf8'));
    Object.assign(claude.mcpServers, { pending: { type: 'stdio', command: 'P' }, changed: { type: 'stdio', command: 'K2' }, moved: { type: 'stdio', command: 'X' } });
    await writeFile(file('claude-cli'), JSON.stringify(claude, null, 2));
    await writeFile(file('codex-cli'), `${await readFile(file('codex-cli'), 'utf8')}\n[mcp_servers.pending]\ncommand = "P2"\n\n[mcp_servers.moved]\ncommand = "M"\n`);
    const pi = JSON.parse(await readFile(file('pi-cli'), 'utf8'));
    Object.assign(pi.mcpServers, { pending: { command: 'P' }, moved: { command: 'M' } });
    await writeFile(file('pi-cli'), JSON.stringify(pi, null, 2));
    await applyServers(box.context, managed, []);
    const items = JSON.parse(await readFile(join(box.home, '.central-knot/mcp.json'), 'utf8')).items;
    assert.deepEqual([items.pending.hash, (await readTool(box.context, 'pi-cli')).entries.find(entry => entry.name === 'pending')?.server.command], [H('P2'), 'P2'], 'Codex’s edit is current, and reaches Pi');
    assert.equal(items.changed.applied['claude-cli'], undefined, 'nothing applied: the edited entry is left as it is');
    assert.deepEqual([items.moved.applied['claude-cli'], items.moved.except], [undefined, ['claude-cli']], 'Claude Code’s differing entry is left as it is');
    await writeToClaude(box.context, managed, ['changed', 'moved']);
    const after = (await readTool(box.context, 'claude-cli')).entries;
    assert.deepEqual([after.find(entry => entry.name === 'changed')?.server.command, after.find(entry => entry.name === 'moved')?.server.command], ['K2', 'X']);
  } finally { await box.cleanup(); }
});
