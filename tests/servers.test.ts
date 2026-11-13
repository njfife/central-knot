// MCP servers on Central Knot's library, on real settings files in a temp home with all five tools (servers.ts): a found
// server taken in, Off and On with each tool's own fields, Claude Code's file written only by Write to Claude Code, hand edits
// and deletions, files that are missing, unreadable or rewritten, what is never taken in, what a tool can't hold, and a tool's
// own switch left as it is. The model's rule is library.ts's; each case here is a worked example of it on entries.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { readHistory } from '../src/history.ts';
import { libraryAction } from '../src/historyactions.ts';
import { kindSource } from '../src/itemrow.ts';
import { asItIs, canTakeIn, libraryWords, sentences, statusLine } from '../src/libraryrow.ts';
import { readTool, writeEntry } from '../src/mcp.ts';
import { discover } from '../src/discovery.ts';
import { saveProfile, switchProfile, readProfiles } from '../src/profiles.ts';
import { applyServers, restoreServer, serversView, writeToClaude } from '../src/servers.ts';
import type { ShareContext } from '../src/share.ts';
import type { Change, HarnessId, HomeView, LibraryFacts } from '../src/types.ts';

const all: HarnessId[] = ['claude-cli', 'copilot-cli', 'codex-cli', 'pi-cli', 'opencode-cli'];
const FILES: Record<HarnessId, string> = {
  'claude-cli': '.claude.json', 'copilot-cli': '.copilot/mcp-config.json', 'codex-cli': '.codex/config.toml', 'pi-cli': '.pi/agent/mcp.json', 'opencode-cli': '.config/opencode/opencode.json',
};
const say = sentences(libraryWords.mcp);

async function sandbox() {
  const base = await realpath(await mkdtemp(join(tmpdir(), 'ck-servers-')));
  const home = join(base, 'home');
  for (const folder of ['.claude', '.copilot', '.codex', '.pi/agent', '.config/opencode']) await mkdir(join(home, folder), { recursive: true });
  const context: ShareContext = { home, mode: 'custom', read: async () => [], build: 'test', settingsPath: join(base, 'settings.json'), realHome: join(base, 'real'), settleMs: 0 };
  const path = (tool: HarnessId) => join(home, FILES[tool]);
  const files = async () => Object.fromEntries(await Promise.all(all.map(async tool => [tool, await readFile(path(tool), 'utf8').catch(() => undefined)] as const)));
  const view = () => serversView(context, all);
  const row = async (key: string) => (await view()).items.find(item => item.key === key);
  const send = (change: Change, tools = all) => applyServers(context, tools, [change]);
  return { home, context, path, files, view, row, send, cleanup: () => rm(base, { recursive: true, force: true }) };
}
type Box = Awaited<ReturnType<typeof sandbox>>;
const on = (key: string): Change => ({ key, managed: true, off: [] });
const off = (key: string): Change => ({ key, managed: false, off: [], seenManaged: true });
const commandIn = async (box: Box, tool: HarnessId, name = 'docs') => (await readTool(box.context, tool)).entries.find(entry => entry.name === name)?.server.command;
const argsIn = async (box: Box, tool: HarnessId, name = 'docs') => (await readTool(box.context, tool)).entries.find(entry => entry.name === name)?.server.args;

/** docs in every tool, the same server, each with fields of that tool's own (the server is each file's last entry). */
async function docsEverywhere(box: Box) {
  await writeFile(box.path('claude-cli'), `${JSON.stringify({ numStartups: 7, mcpServers: { docs: { type: 'stdio', command: 'npx', args: ['-y', 'docs'], env: { TOKEN: 'secret-value-123' }, timeout: 30 } }, projects: { '/x': {} } }, null, 2)}\n`);
  await writeFile(box.path('copilot-cli'), `${JSON.stringify({ mcpServers: { docs: { type: 'local', command: 'npx', args: ['-y', 'docs'], env: { TOKEN: 'secret-value-123' }, tools: ['search'], timeout: 9 } } }, null, 2)}\n`);
  await writeFile(box.path('codex-cli'), 'model = "gpt-6"\n# mine\n\n[profiles.work]\nmodel = "o3"\n\n[mcp_servers.docs]\ncommand = "npx"\nargs = ["-y", "docs"]\nenabled = false\nstartup_timeout_sec = 9\n\n[mcp_servers.docs.env]\nTOKEN = "secret-value-123"\n\n[mcp_servers.docs.tools.search]\napproval_mode = "approve"\n');
  await writeFile(box.path('pi-cli'), `${JSON.stringify({ mcpServers: { docs: { command: 'npx', args: ['-y', 'docs'], env: { TOKEN: 'secret-value-123' }, lifecycle: 'lazy' } } }, null, 2)}\n`);
  await writeFile(box.path('opencode-cli'), '{\n  // mine\n  "mcp": {\n    "docs": { "type": "local", "command": ["npx", "-y", "docs"], "environment": { "TOKEN": "secret-value-123" }, "timeout": 5000 }\n  }\n}\n');
}

test('A found server is taken in: every tool without it gets it, values as they are; the rest of each file stays; a second pass writes nothing', async () => {
  const box = await sandbox();
  try {
    await writeFile(box.path('claude-cli'), `${JSON.stringify({ numStartups: 7, mcpServers: { docs: { type: 'stdio', command: 'npx', args: ['-y', 'docs'], env: { TOKEN: 'secret-value-123' } } } }, null, 2)}\n`);
    const codex = 'model = "gpt-6"\n# my comment stays\n\n[[skills.config]]\nname = "docs:pdf"\nenabled = false\n';
    await writeFile(box.path('codex-cli'), codex);
    const found = await box.row('docs');
    assert.deepEqual([found?.on, found?.plan, Object.keys(found?.copies ?? {})], [false, undefined, ['claude-cli']]);
    const done = await box.send(on('docs'));
    assert.deepEqual(done.results.map(entry => [entry.harness, entry.outcome]), [['copilot-cli', 'written'], ['codex-cli', 'written'], ['pi-cli', 'written'], ['opencode-cli', 'written']]);
    assert.deepEqual(JSON.parse((await box.files())['copilot-cli']!).mcpServers.docs, { type: 'local', command: 'npx', args: ['-y', 'docs'], env: { TOKEN: 'secret-value-123' }, tools: ['*'] });
    const toml = (await box.files())['codex-cli']!;
    assert.ok(toml.startsWith(codex), 'everything already in config.toml stays byte for byte');
    assert.ok(toml.includes('[mcp_servers.docs]\ncommand = "npx"\nargs = ["-y", "docs"]') && toml.includes('[mcp_servers.docs.env]\nTOKEN = "secret-value-123"'));
    assert.deepEqual(JSON.parse((await box.files())['opencode-cli']!).mcp.docs, { type: 'local', command: ['npx', '-y', 'docs'], environment: { TOKEN: 'secret-value-123' } });
    const after = await box.files();
    assert.equal((await applyServers(box.context, all, [])).writes, 0, 'a repeat writes nothing');
    assert.deepEqual(await box.files(), after);
    const entry = (await readHistory(box.context)).find(event => event.key === 'mcp:docs')!;
    assert.deepEqual([entry.kind, entry.cause, entry.winner?.tool], ['on', 'found', 'claude-cli']);
  } finally { await box.cleanup(); }
});

test('Off takes the entry out of every tool, Claude Code’s once Write to Claude Code runs; On puts each back with its own fields, every file byte for byte', async () => {
  const box = await sandbox();
  try {
    await docsEverywhere(box);
    await box.send(on('docs'));
    const before = await box.files();
    const offDone = await box.send(off('docs'));
    assert.deepEqual(offDone.results.filter(entry => entry.waits).map(entry => entry.harness), ['claude-cli']);
    const offFiles = await box.files();
    assert.equal(offFiles['claude-cli'], before['claude-cli'], 'Claude Code’s file waits for Write to Claude Code');
    for (const tool of all.slice(1)) assert.equal(await commandIn(box, tool), undefined, `${tool} no longer has it`);
    assert.equal(offFiles['codex-cli'], 'model = "gpt-6"\n# mine\n\n[profiles.work]\nmodel = "o3"\n', 'Codex’s other tables and comments stay');
    assert.deepEqual((await box.row('docs'))?.waits, ['claude-cli']);
    await writeToClaude(box.context, all, ['docs']);
    assert.equal(await commandIn(box, 'claude-cli'), undefined);
    assert.deepEqual((await box.row('docs'))?.waits, undefined, 'nothing is owed any more');

    const onDone = await box.send({ ...on('docs'), seenManaged: false });
    assert.deepEqual(onDone.results.filter(entry => entry.waits).map(entry => entry.harness), ['claude-cli']);
    await writeToClaude(box.context, all, ['docs']);
    // The same: the same values and own fields, and every other byte of each file; the entry's place and key order are
    // Central Knot's (an entry it wrote itself comes back byte for byte: Claude Code's, Copilot's and Codex's here).
    const after = await box.files(), entry = async (tool: HarnessId) => { const found = (await readTool(box.context, tool)).entries[0]!; return [found.server, found.extras]; };
    for (const tool of all) {
      assert.equal(writeEntry(after[tool]!, tool, 'docs', undefined), writeEntry(before[tool]!, tool, 'docs', undefined), `${tool}: every other byte as it was`);
      await writeFile(box.path(tool), before[tool]!);
      const was = await entry(tool);
      await writeFile(box.path(tool), after[tool]!);
      assert.deepEqual(await entry(tool), was, `${tool}: the same values and own fields`);
    }
    for (const tool of ['claude-cli', 'copilot-cli', 'codex-cli'] as const) assert.equal(after[tool], before[tool], `${tool}: byte for byte`);
  } finally { await box.cleanup(); }
});

test('Off with Claude Code open, then On again, then Off and Delete from Central Knot, each before the write: what the row, the band and History say, never that the write is done', async () => {
  const box = await sandbox();
  try {
    await writeFile(box.path('claude-cli'), `${JSON.stringify({ mcpServers: { docs: { type: 'stdio', command: 'npx' } } }, null, 2)}\n`);
    await box.send(on('docs'));
    const claude = (await box.files())['claude-cli'];
    // Off: every tool but Claude Code; the row says Claude Code still has it, and it is what the band writes.
    await box.send(off('docs'));
    let row = (await box.row('docs'))!, view = await box.view();
    assert.deepEqual(row.waits, ['claude-cli']);
    assert.equal(statusLine({ ...row, hashes: hashes(row) }, view.library.docs, view.tools), 'Off · still in Claude Code until you click Write to Claude Code. Turn it on to put it in every tool.');
    assert.equal(say.placeTag({ ...row, hashes: hashes(row) }, view.library.docs, view.tools)?.text, 'still in Claude Code until Write', 'not “in Central Knot only”');
    assert.equal(say.harnessLine({ ...row, hashes: hashes(row) }, view.library.docs, 'claude-cli', 'Claude Code'), 'Its entry here is removed when you click Write to Claude Code. Central Knot keeps it.');
    const offEntry = (await readHistory(box.context)).at(-1)!;
    assert.deepEqual([offEntry.kind, offEntry.losers.map(loser => loser.tool)], ['off', ['copilot-cli', 'codex-cli', 'pi-cli', 'opencode-cli']], 'History names only the tools it was taken out of');
    // On again before the write: Claude Code has the current version still, so nothing is owed there.
    await box.send({ ...on('docs'), seenManaged: false });
    row = (await box.row('docs'))!;
    assert.deepEqual([row.on, row.waits, (await box.files())['claude-cli']], [true, undefined, claude]);
    // Off and Delete from Central Knot before the write: a deleted server whose entry is still in Claude Code is a found row
    // that says so, and the band writes its removal.
    await box.send(off('docs'));
    await box.send({ key: 'docs', managed: false, off: [], seenManaged: false, deleted: true });
    view = await box.view();
    row = view.items.find(item => item.key === 'docs')!;
    assert.deepEqual([row.on, row.waits, view.library.docs.deleted !== undefined], [false, ['claude-cli'], true]);
    assert.equal(statusLine({ ...row, hashes: hashes(row) }, undefined, view.tools), 'Deleted from Central Knot · Claude Code still has it until you click Write to Claude Code. History can restore it.');
    assert.equal(say.harnessLine({ ...row, hashes: hashes(row) }, undefined, 'claude-cli', 'Claude Code'), 'Its entry here is removed when you click Write to Claude Code. History can restore it.');
    assert.equal(canTakeIn({ ...row, hashes: hashes(row) }), false, 'no Add while the band is about to remove its last copy');
    await writeToClaude(box.context, all, ['docs']);
    view = await box.view();
    assert.deepEqual([view.items, await commandIn(box, 'claude-cli')], [[], undefined], 'gone from Claude Code, and from the page');
    const deleted = (await readHistory(box.context)).filter(event => event.kind === 'deleted').at(-1)!;
    assert.equal(libraryAction(deleted, view.library.docs)?.label, 'Restore');
  } finally { await box.cleanup(); }
});
const hashes = (row: LibraryFacts) => Object.fromEntries(Object.entries(row.copies).map(([tool, copy]) => [tool, copy!.hash]));

test('`codex mcp remove` of Codex’s only server turns it Off everywhere; Central Knot keeps it, and Turn on puts each entry back', async () => {
  const box = await sandbox();
  try {
    await writeFile(box.path('codex-cli'), 'model = "gpt-6"\n\n[mcp_servers.docs]\ncommand = "npx"\nargs = ["-y", "docs"]\n');
    await box.send(on('docs'));
    assert.equal(await commandIn(box, 'copilot-cli'), 'npx');
    // What `codex mcp remove docs` leaves: no servers table at all.
    await writeFile(box.path('codex-cli'), 'model = "gpt-6"\n');
    const pass = await applyServers(box.context, all, []);
    assert.deepEqual(pass.notices?.map(notice => [notice.kind, notice.winner]), [['deleted', 'codex-cli']]);
    for (const tool of all.slice(1)) assert.equal(await commandIn(box, tool), undefined, `${tool}: Off everywhere`);
    const view = await box.view();
    assert.deepEqual([view.items[0]?.on, view.library.docs.versions.length], [false, 1]);
    const entry = (await readHistory(box.context)).find(event => event.cause === 'deleted-by-hand')!;
    assert.equal(libraryAction(entry, view.library.docs)?.label, 'Turn on');
    await restoreServer(box.context, all, entry.id);
    assert.deepEqual([await argsIn(box, 'codex-cli'), await argsIn(box, 'copilot-cli')], [['-y', 'docs'], ['-y', 'docs']]);
  } finally { await box.cleanup(); }
});

test('A settings file that can’t be seen is no set of deletions: missing is away and written afresh once the settle window has passed; unreadable makes the tool unseen', async () => {
  const box = await sandbox();
  try {
    await writeFile(box.path('copilot-cli'), JSON.stringify({ mcpServers: { docs: { type: 'local', command: 'npx' } } }));
    await box.send(on('docs'));
    const slow = { ...box.context, settleMs: 2000 }, at = Date.now() + 1e6;
    // Missing: inside the window nothing happens; past it the file is written afresh and the server stays On.
    await rm(box.path('copilot-cli'));
    const inside = await applyServers(slow, all, [], { now: at });
    assert.deepEqual([inside.writes, inside.settling, (await box.row('docs'))?.on], [0, true, true]);
    await applyServers(slow, all, [], { now: at + 3000 });
    assert.deepEqual([await commandIn(box, 'copilot-cli'), (await box.row('docs'))?.on], ['npx', true]);
    // Each entry has its own settle clock: one gone for longer than the window counts, one gone just now doesn't yet.
    await writeFile(box.path('copilot-cli'), JSON.stringify({ mcpServers: { docs: { type: 'local', command: 'npx' }, more: { type: 'local', command: 'more' } } }));
    await box.send(on('more'));
    await writeFile(box.path('codex-cli'), (await box.files())['codex-cli']!.replace(/\n?\[mcp_servers\.docs\][^[]*/, '\n'));
    await applyServers(slow, all, [], { now: at + 4000 });
    await writeFile(box.path('codex-cli'), (await box.files())['codex-cli']!.replace(/\n?\[mcp_servers\.more\][^[]*/, '\n'));
    await applyServers(slow, all, [], { now: at + 5500 });
    const clocks = await box.view();
    assert.deepEqual(clocks.items.filter(item => item.key !== 'node_repl').map(item => [item.key, item.on]), [['docs', true], ['more', true]], 'both still inside their windows');
    await applyServers(slow, all, [], { now: at + 6100 });
    assert.deepEqual((await box.view()).items.map(item => [item.key, item.on]), [['docs', false], ['more', true]], 'docs’s window has passed, more’s has not');
    await box.send({ ...on('docs'), seenManaged: false });
    await applyServers(slow, all, [], { now: at + 9000 });
    await box.send({ ...on('more'), seenManaged: false });
    // An entry missing for less than the window: nothing; past it, deleted by hand.
    const pi = (await box.files())['pi-cli']!;
    await writeFile(box.path('pi-cli'), '{ "mcpServers": {} }\n');
    assert.equal((await applyServers(slow, all, [], { now: at + 10_000 })).writes, 0);
    await writeFile(box.path('pi-cli'), pi);
    assert.equal((await applyServers(slow, all, [], { now: at + 20_000 })).writes, 0, 'back within the window: nothing to do');
    // Unreadable: the whole tool is unseen, its file never written, and nothing turns Off.
    await writeFile(box.path('codex-cli'), '[mcp_servers.docs\ncommand = ');
    await box.send(off('docs'));
    assert.equal((await box.files())['codex-cli'], '[mcp_servers.docs\ncommand = ');
    assert.match((await box.row('docs'))?.unseen?.['codex-cli'] ?? '', /could not be read as TOML/);
  } finally { await box.cleanup(); }
});

test('An edit in one tool becomes the current version and reaches the others; of two, the first tool’s wins and the other is kept; own fields alone are no edit', async () => {
  const box = await sandbox();
  try {
    await docsEverywhere(box);
    await box.send(on('docs'));
    // A tool's own field changed alone (Copilot's timeout): kept as its own part, nothing written, no version.
    const copilot = JSON.parse((await box.files())['copilot-cli']!);
    copilot.mcpServers.docs.timeout = 99;
    await writeFile(box.path('copilot-cli'), JSON.stringify(copilot));
    assert.equal((await applyServers(box.context, all, [])).writes, 0);
    assert.equal((await box.view()).library.docs.versions.length, 1);
    // An edit in Codex: the current version, in every tool but Claude Code, which waits.
    await writeFile(box.path('codex-cli'), (await box.files())['codex-cli']!.replace('args = ["-y", "docs"]', 'args = ["-y", "docs", "--v2"]'));
    const edited = await applyServers(box.context, all, []);
    assert.deepEqual(edited.notices?.map(notice => [notice.kind, notice.winner]), [['edit', 'codex-cli']]);
    for (const tool of ['copilot-cli', 'pi-cli', 'opencode-cli'] as const) assert.deepEqual(await argsIn(box, tool), ['-y', 'docs', '--v2'], tool);
    assert.equal(JSON.parse((await box.files())['copilot-cli']!).mcpServers.docs.timeout, 99, 'Copilot keeps its own field');
    assert.deepEqual((await box.row('docs'))?.waits, ['claude-cli']);
    // Two edits in one pass: an entry has no time of its own, so the first tool's wins and the other is a version.
    await writeFile(box.path('pi-cli'), (await box.files())['pi-cli']!.replace('"--v2"', '"--pi"'));
    await writeFile(box.path('opencode-cli'), (await box.files())['opencode-cli']!.replace('"--v2"', '"--opencode"'));
    const both = await applyServers(box.context, all, []);
    assert.deepEqual(both.notices?.map(notice => [notice.kind, notice.winner, notice.losers]), [['conflict', 'pi-cli', ['opencode-cli']]]);
    assert.deepEqual(await argsIn(box, 'opencode-cli'), ['-y', 'docs', '--pi']);
    assert.ok((await box.view()).library.docs.versions.some(version => version.from.how === 'edited' && version.from.harness === 'opencode-cli'));
  } finally { await box.cleanup(); }
});

test('What is never taken in says why and offers nothing: a server that belongs to an app, a form Central Knot doesn’t edit, two names that differ only by case, a plugin’s part', async () => {
  const box = await sandbox();
  try {
    await writeFile(box.path('codex-cli'), '[mcp_servers.node_repl]\ncommand = "/Applications/ChatGPT.app/Contents/Resources/node"\n\n[mcp_servers]\ninline = { command = "x" }\n');
    await writeFile(box.path('copilot-cli'), JSON.stringify({ mcpServers: { Twice: { command: 'a' }, twice: { command: 'b' }, part: { command: 'p' } } }));
    await writeFile(box.path('opencode-cli'), JSON.stringify({ mcp: { both: { type: 'local', command: ['a'] }, servers: { both: { type: 'local', command: ['b'] } } } }));
    await mkdir(join(box.home, '.central-knot'), { recursive: true });
    await writeFile(join(box.home, '.central-knot/plugin-parts.json'), JSON.stringify({ installs: [{ source: '/m', marketName: 'm', plugin: 'tools', version: '1', tool: 'copilot-cli', at: '', digest: 'd', items: [{ kind: 'mcp', name: 'part', hash: 'h' }] }] }));
    const view = await box.view();
    const said = Object.fromEntries(view.items.map(item => [item.key, [Object.keys(item.copies).length, Object.values(item.unseen ?? {})[0]]]));
    assert.deepEqual(said, {
      both: [0, 'OpenCode’s entry for it is not written in a form Central Knot edits, so it is left alone.'],
      inline: [0, 'Codex’s entry for it is not written in a form Central Knot edits, so it is left alone.'],
      node_repl: [0, 'ChatGPT desktop keeps this server for itself.'],
      part: [0, 'Copilot CLI has it as part of a plugin Central Knot installed there, so it is the plugin’s.'],
      twice: [0, 'Two servers whose names differ only by case are in Copilot CLI’s settings. Rename one so Central Knot can tell them apart.'],
    });
    const before = await box.files();
    for (const key of Object.keys(said)) assert.match((await box.send(on(key))).results[0]?.message ?? '', /No tool has a copy of it to take in/);
    assert.deepEqual(await box.files(), before);
  } finally { await box.cleanup(); }
});

test('SSE can’t go to Codex, Pi or OpenCode: held with its reason; a tool holding a copy keeps it when the current version becomes SSE', async () => {
  const box = await sandbox();
  try {
    await writeFile(box.path('claude-cli'), JSON.stringify({ mcpServers: { live: { type: 'sse', url: 'https://example.com/sse' }, docs: { type: 'stdio', command: 'npx' } } }));
    await box.send(on('live'));
    assert.deepEqual([await commandIn(box, 'copilot-cli', 'live'), (await readTool(box.context, 'copilot-cli')).entries.map(entry => entry.server.transport)], [undefined, ['sse']]);
    const live = (await box.row('live'))!;
    for (const tool of ['codex-cli', 'pi-cli', 'opencode-cli'] as const) assert.match(live.cannot[tool] ?? '', /has no SSE transport/, tool);
    await box.send(on('docs'));
    const codex = (await box.files())['codex-cli'];
    await writeFile(box.path('copilot-cli'), JSON.stringify({ mcpServers: { live: { type: 'sse', url: 'https://example.com/sse' }, docs: { type: 'sse', url: 'https://example.com/docs' } } }));
    await applyServers(box.context, all, []);
    assert.equal((await box.files())['codex-cli'], codex, 'Codex keeps the copy it has');
    assert.match((await box.row('docs'))?.cannot['codex-cli'] ?? '', /has no SSE transport/);
  } finally { await box.cleanup(); }
});

test('Make current with Automatic sync off asks after the click what each tool can hold: an earlier version reaches Codex though the current one was SSE', async () => {
  const box = await sandbox();
  try {
    const claude = (server: object) => writeFile(box.path('claude-cli'), JSON.stringify({ mcpServers: { docs: server } }));
    const settle = async () => { await applyServers(box.context, all, []); await writeToClaude(box.context, all, ['docs']); await applyServers(box.context, all, []); };
    await claude({ type: 'stdio', command: 'version-1' });
    await box.send(on('docs')); await writeToClaude(box.context, all, ['docs']);
    const first = (await box.view()).library.docs.hash;
    await claude({ type: 'stdio', command: 'version-2' }); await settle();
    await claude({ type: 'sse', url: 'https://docs.example/sse' }); await settle();
    assert.equal(await commandIn(box, 'codex-cli'), 'version-2', 'Codex keeps the copy it can hold');
    // Make current version-1: a click's own pass, as with Automatic sync off.
    await applyServers(box.context, all, [{ ...asItIs('docs', (await box.view()).library.docs), version: first }], { only: new Set(['docs']) });
    assert.deepEqual([await commandIn(box, 'codex-cli'), await commandIn(box, 'pi-cli'), (await box.row('docs'))?.cannot], ['version-1', 'version-1', {}]);
  } finally { await box.cleanup(); }
});

test('A tool’s own switch is left as it is: a profile left a server out, then Off, a profile switch and On; the switch inside Codex’s and OpenCode’s entries comes back with it, where each had it', async () => {
  const box = await sandbox();
  try {
    const tools: HarnessId[] = ['claude-cli', 'codex-cli', 'opencode-cli'];
    box.context.read = () => Promise.all(tools.map(harness => discover({ home: box.home, mode: 'custom', harness })));
    await writeFile(box.path('claude-cli'), `${JSON.stringify({ mcpServers: { docs: { type: 'stdio', command: 'npx' } } }, null, 2)}\n`);
    // OpenCode's newer line keeps it under `mcp.servers`, where its switch is `disabled`.
    await writeFile(box.path('opencode-cli'), `${JSON.stringify({ mcp: { servers: { docs: { type: 'local', command: ['npx'] } } } }, null, 2)}\n`);
    await writeFile(join(box.home, '.claude/settings.json'), '{\n  "theme": "dark"\n}\n');
    await box.send(on('docs'), tools);
    await writeToClaude(box.context, tools, ['docs']);
    // A profile without it: Codex's and OpenCode's switch in their entry, Claude Code's in its settings list.
    const profile = (await saveProfile(box.context, { name: 'Writing', items: [] })).id!;
    assert.equal((await switchProfile(box.context, profile)).stopped, undefined);
    let view = await serversView(box.context, tools);
    assert.deepEqual(view.items[0]?.switchedOff, ['claude-cli', 'codex-cli', 'opencode-cli']);
    const home = { skills: { tools, items: [], library: {} }, mcp: view, agents: { tools, items: [], library: {} }, profiles: await readProfiles(box.home) } as unknown as HomeView;
    assert.deepEqual(kindSource(home, 'mcp').facts[0]?.switched, { 'claude-cli': 'switched off in Claude Code by the profile Writing', 'codex-cli': 'switched off in Codex by the profile Writing', 'opencode-cli': 'switched off in OpenCode by the profile Writing' });
    assert.match(say.harnessLine({ key: 'docs', hashes: { 'codex-cli': 'x' }, plan: { current: ['codex-cli'], write: [], remove: [], forget: [], found: [], keep: [] }, switched: { 'codex-cli': 'switched off in Codex’s own settings' } }, view.library.docs, 'codex-cli', 'Codex'),
      /It is switched off in Codex’s own settings: Codex doesn’t start it\. Central Knot leaves that switch as it is, so it is still off there after Off and On\./);
    // Off: out of Codex (its own fields kept, the switch with them); Claude Code waits.
    await box.send(off('docs'), tools);
    assert.equal(await commandIn(box, 'codex-cli'), undefined);
    // No profile: back on only where a profile turned it off and the tool still has it (Claude Code's entry, still waiting).
    await switchProfile(box.context, null);
    assert.doesNotMatch(await readFile(join(box.home, '.claude/settings.json'), 'utf8'), /deniedMcpServers/);
    // On: Codex's and OpenCode's entries come back as they were, each where it was and switched off in its own fields; the row says so.
    await box.send({ ...on('docs'), seenManaged: false }, tools);
    assert.match((await box.files())['codex-cli']!, /\[mcp_servers\.docs\]\ncommand = "npx"\nenabled = false\n/);
    assert.deepEqual(JSON.parse((await box.files())['opencode-cli']!).mcp, { servers: { docs: { type: 'local', command: ['npx'], disabled: true } } });
    view = await serversView(box.context, tools);
    assert.deepEqual([view.items[0]?.on, view.items[0]?.switchedOff], [true, ['codex-cli', 'opencode-cli']]);
  } finally { await box.cleanup(); }
});

test('Taking in a server Claude Code had offers no Undo: giving Claude Code its copy back would wait for Write to Claude Code, and that write would remove it', async () => {
  const box = await sandbox();
  try {
    await writeFile(box.path('claude-cli'), JSON.stringify({ numStartups: 4, mcpServers: { docs: { type: 'stdio', command: 'npx', args: ['docs'], timeout: 39 } } }));
    await box.send(on('docs'));
    const add = (await readHistory(box.context)).find(event => event.kind === 'on' && event.cause === 'found')!;
    assert.equal(libraryAction(add, (await box.view()).library.docs), undefined, 'neither the result’s band nor History offers it');
    assert.match((await restoreServer(box.context, all, add.id)).stopped ?? '', /nothing left to undo/);
    assert.equal((await box.row('docs'))?.waits, undefined, 'so the band never offers to remove the entry from Claude Code');
    // The way out is Off (Central Knot keeps it); Claude Code's entry goes only with that, at Write to Claude Code.
    await writeToClaude(box.context, all, ['docs']);
    assert.deepEqual([await commandIn(box, 'claude-cli'), (await box.row('docs'))?.on], ['npx', true]);
    // Taken in from a tool that is written at once, its Undo is offered and gives the copy back.
    await writeFile(box.path('copilot-cli'), JSON.stringify({ mcpServers: { files: { type: 'local', command: 'files' } } }));
    await box.send(on('files'));
    const files = (await readHistory(box.context)).find(event => event.key === 'mcp:files' && event.kind === 'on')!;
    assert.equal(libraryAction(files, (await box.view()).library.files)?.label, 'Undo');
  } finally { await box.cleanup(); }
});

test('Write to Claude Code with Automatic sync off writes only what the rows it names owe Claude Code', async () => {
  const box = await sandbox();
  try {
    await writeFile(box.path('copilot-cli'), JSON.stringify({ mcpServers: { a: { type: 'local', command: 'a' }, b: { type: 'local', command: 'b' } } }));
    // Codex's file can't be read while they are added, so Codex is owed them too.
    await writeFile(box.path('codex-cli'), 'model = [');
    await box.send(on('a'));
    await box.send(on('b'));
    await writeFile(box.path('codex-cli'), 'model = "x"\n');
    assert.deepEqual((await box.view()).items.map(item => [item.key, item.waits]), [['a', ['claude-cli']], ['b', ['claude-cli']]]);
    const done = await writeToClaude(box.context, all, ['a']);
    assert.deepEqual([await commandIn(box, 'claude-cli', 'a'), await commandIn(box, 'claude-cli', 'b'), await commandIn(box, 'codex-cli', 'a')], ['a', undefined, undefined]);
    assert.deepEqual(done.results.map(result => [result.item, result.harness, result.outcome]), [['a', 'claude-cli', 'written']], 'it says only what it did in Claude Code');
    assert.deepEqual((await box.view()).items.map(item => [item.key, item.waits]), [['a', undefined], ['b', ['claude-cli']]]);
    // The next pass of sync (or a click on the row) writes Codex.
    await applyServers(box.context, all, []);
    assert.deepEqual([await commandIn(box, 'codex-cli', 'a'), await commandIn(box, 'codex-cli', 'b')], ['a', 'b']);
  } finally { await box.cleanup(); }
});

test('Names that differ only by case in two tools are one server; each tool’s entry keeps its own name, through Off and On too', async () => {
  const box = await sandbox();
  try {
    await writeFile(box.path('copilot-cli'), JSON.stringify({ mcpServers: { GitHub: { type: 'local', command: 'gh-mcp' } } }));
    await writeFile(join(box.home, '.copilot/settings.json'), JSON.stringify({ disabledMcpServers: ['GitHub'] }));
    await writeFile(box.path('codex-cli'), '[mcp_servers.github]\ncommand = "gh-mcp"\n\n[mcp_servers.github.tools.search]\napproval_mode = "approve"\n');
    assert.deepEqual((await box.view()).items.map(item => [item.key, item.name, Object.keys(item.copies)]), [['github', 'GitHub', ['copilot-cli', 'codex-cli']]]);
    await box.send(on('github'));
    await writeFile(box.path('codex-cli'), '[mcp_servers.github]\ncommand = "gh-mcp"\nargs = ["--v2"]\n\n[mcp_servers.github.tools.search]\napproval_mode = "approve"\n');
    await applyServers(box.context, all, []);
    assert.deepEqual([await argsIn(box, 'copilot-cli', 'GitHub'), await argsIn(box, 'pi-cli', 'GitHub')], [['--v2'], ['--v2']]);
    assert.match((await box.files())['codex-cli']!, /\[mcp_servers\.github\]/);
    // Off, then On: each tool's entry is back under the name it had there, so Codex's own subtable is still its, and
    // Copilot's own switch (by name, in its settings) still matches.
    await box.send(off('github'));
    await box.send({ ...on('github'), seenManaged: false });
    assert.equal((await box.files())['codex-cli'], '[mcp_servers.github]\ncommand = "gh-mcp"\nargs = ["--v2"]\n\n[mcp_servers.github.tools.search]\napproval_mode = "approve"\n');
    assert.deepEqual([await argsIn(box, 'copilot-cli', 'GitHub'), (await box.row('github'))?.switchedOff], [['--v2'], ['copilot-cli']]);
  } finally { await box.cleanup(); }
});

test('Off then On gives Codex’s table back with its comment lines, among its own lines; an inline comment on a shared value is not kept', async () => {
  const box = await sandbox();
  try {
    const codex = 'model = "gpt-6"\n\n[mcp_servers.docs]\n# Start it from the team folder.\ncommand = "npx" # pinned\nargs = ["docs"]\nstartup_timeout_sec = 31 # the network is slow\n';
    const tools: HarnessId[] = ['codex-cli', 'pi-cli'];
    await writeFile(box.path('codex-cli'), codex);
    await box.send(on('docs'), tools);
    assert.equal((await box.files())['codex-cli'], codex, 'taking it in writes nothing there');
    await box.send(off('docs'), tools);
    await box.send({ ...on('docs'), seenManaged: false }, tools);
    assert.equal((await box.files())['codex-cli'], 'model = "gpt-6"\n\n[mcp_servers.docs]\ncommand = "npx"\nargs = ["docs"]\n# Start it from the team folder.\nstartup_timeout_sec = 31 # the network is slow\n');
    // An edit in another tool, written over Codex's entry, keeps them too.
    await writeFile(box.path('pi-cli'), JSON.stringify({ mcpServers: { docs: { command: 'npx', args: ['docs', '--v2'] } } }));
    await applyServers(box.context, tools, []);
    assert.match((await box.files())['codex-cli']!, /args = \["docs", "--v2"\]\n# Start it from the team folder\.\nstartup_timeout_sec = 31/);
  } finally { await box.cleanup(); }
});

test('A damaged or newer MCP record stops every write and is never rewritten', async () => {
  for (const record of ['{', JSON.stringify({ formatVersion: 3, items: {} })]) {
    const box = await sandbox();
    try {
      await writeFile(box.path('copilot-cli'), JSON.stringify({ mcpServers: { docs: { command: 'x' } } }));
      await mkdir(join(box.home, '.central-knot'), { recursive: true });
      await writeFile(join(box.home, '.central-knot/mcp.json'), record);
      const done = await box.send(on('docs'));
      assert.match(done.stopped ?? '', /MCP record (is damaged|was written by a newer)/);
      assert.equal(await readFile(join(box.home, '.central-knot/mcp.json'), 'utf8'), record);
      assert.equal(await commandIn(box, 'codex-cli'), undefined);
    } finally { await box.cleanup(); }
  }
});
