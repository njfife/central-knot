// MCP servers on Central Knot's library, on real settings files in a temp home with all five tools (servers.ts): a found
// server taken in, Off and On with each tool's own fields, a tool installed later and what the Caught up band says of it,
// Claude Code's file written in the same pass as every tool's (and a home alpha 2 left with Claude Code's writes still owed),
// hand edits and deletions, files that are missing, unreadable or
// rewritten, what is never taken in, what a tool can't hold, and a tool's own switch left as it is; at the end, saves that land
// while a pass writes, a crash inside a checked write, and entries in less common forms. The model's rule is library.ts's; each
// case here is a worked example of it on entries.
import { test } from 'node:test';
import { bandAfter, itemNotice } from './notices.ts';
import assert from 'node:assert/strict';
import fs, { chmod, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { setSyncEverything } from '../src/everything.ts';
import { readHistory } from '../src/history.ts';
import { libraryAction, librarySentence } from '../src/historyactions.ts';
import { asItIs, libraryWords, sentences, statusLine } from '../src/libraryrow.ts';
import { readTool, writeEntry } from '../src/mcp.ts';
import { discover } from '../src/discovery.ts';
import { homePass, passTells, syncOnceReport } from '../src/homepass.ts';
import { mcpSwitchPath, withMcpSwitch } from '../src/mcpswitch.ts';
import { applyServers, restoreServer, serversView } from '../src/servers.ts';
import type { ShareContext } from '../src/share.ts';
import { readTomlTables } from '../src/textedit.ts';
import type { Change, HarnessId, HomeView, LibraryFacts } from '../src/types.ts';

/** Nothing waits in the tools: no copy holds an edit not taken in, and these three are managed (historyactions.ts ItemNow). */
const settled = { managed: ['claude-cli', 'copilot-cli', 'codex-cli'] as HarnessId[], pending: [] as HarnessId[] };
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
const on = (key: string): Change => ({ key, on: true, except: [] });
const off = (key: string): Change => ({ key, on: false, except: [], seenOn: true });
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

/** Claude Code with the plugin issue-kit (from the marketplace team) installed, whose .mcp.json brings a server “issues” of these fields. */
async function claudePluginWith(box: Box, fields: unknown) {
  const copy = join(box.home, '.claude/plugins/cache/team/issue-kit/1.0.0');
  await mkdir(join(copy, '.claude-plugin'), { recursive: true });
  await writeFile(join(copy, '.claude-plugin/plugin.json'), JSON.stringify({ name: 'issue-kit', version: '1.0.0' }));
  await writeFile(join(copy, '.mcp.json'), JSON.stringify({ mcpServers: { issues: fields } }));
  await mkdir(join(box.home, '.claude/plugins'), { recursive: true });
  await writeFile(join(box.home, '.claude/plugins/installed_plugins.json'), JSON.stringify({ version: 2, plugins: { 'issue-kit@team': [{ scope: 'user', installPath: copy, version: '1.0.0' }] } }));
}
/** Copilot CLI's own server “issues”, Claude Code's settings with none, and the background pass with Synchronize everything on. */
async function takenInBesidePlugin(box: Box) {
  await writeFile(box.path('claude-cli'), '{\n  "numStartups": 7\n}\n');
  await writeFile(box.path('copilot-cli'), JSON.stringify({ mcpServers: { issues: { type: 'local', command: 'npx', args: ['-y', 'issues-mcp'], tools: ['*'] } } }));
  await setSyncEverything(box.context, true);
  await applyServers(box.context, all, [], { background: true });
}

test('A found server taken in by Synchronize everything where Claude Code has the same server through a plugin: no entry of it goes in Claude Code’s settings, and its row says Claude Code has it through the plugin', async () => {
  const box = await sandbox();
  try {
    await claudePluginWith(box, { command: 'npx', args: ['-y', 'issues-mcp'] });
    await takenInBesidePlugin(box);
    const row = await box.row('issues');
    assert.deepEqual([row?.on, await readFile(box.path('claude-cli'), 'utf8'), await commandIn(box, 'codex-cli', 'issues')], [true, '{\n  "numStartups": 7\n}\n', 'npx']);
    assert.deepEqual(row?.plugin, { 'claude-cli': { plugin: 'issue-kit', marketplace: 'team', version: '1.0.0', name: 'issues' } });
    assert.equal((await applyServers(box.context, all, [], { background: true })).writes, 0);
  } finally { await box.cleanup(); }
});

test('A found server taken in by Synchronize everything where Claude Code’s plugin brings another server of that name: Claude Code gets the server’s entry beside the plugin’s, as a tool without it does', async () => {
  const box = await sandbox();
  try {
    await claudePluginWith(box, { command: 'npx', args: ['-y', 'other-issues-mcp'] });
    await takenInBesidePlugin(box);
    const row = await box.row('issues');
    assert.deepEqual([row?.on, await argsIn(box, 'claude-cli', 'issues'), row?.plugin], [true, ['-y', 'issues-mcp'], undefined]);
    assert.equal((await applyServers(box.context, all, [], { background: true })).writes, 0);
  } finally { await box.cleanup(); }
});

test('A found server whose name Claude Code’s plugin holds as an entry that is no server (not an object): its row doesn’t say Claude Code has it through that plugin', async () => {
  const box = await sandbox();
  try {
    await claudePluginWith(box, 'npx -y issues-mcp');
    await writeFile(box.path('copilot-cli'), JSON.stringify({ mcpServers: { issues: { type: 'local', command: 'npx', args: ['-y', 'issues-mcp'], tools: ['*'] } } }));
    const row = await box.row('issues');
    assert.deepEqual([row?.on, row?.plugin, row?.cannot['claude-cli']], [false, undefined, undefined]);
  } finally { await box.cleanup(); }
});

/** Copilot CLI's server “issues” and the plugin's in Claude Code are one server; Claude Code's own entry of it runs `args`. */
async function ownBesidePlugin(box: Box, args: string[]) {
  await claudePluginWith(box, { command: 'npx', args: ['-y', 'issues-mcp'] });
  await writeFile(box.path('claude-cli'), `${JSON.stringify({ numStartups: 7, mcpServers: { issues: { type: 'stdio', command: 'npx', args } } }, null, 2)}\n`);
  await writeFile(box.path('copilot-cli'), JSON.stringify({ mcpServers: { issues: { type: 'local', command: 'npx', args: ['-y', 'issues-mcp'], tools: ['*'] } } }));
}
const backgroundPass = (box: Box) => applyServers(box.context, all, [], { background: true });

test('A found server taken in where Claude Code has it through a plugin and an entry of its own with that content: the take-in puts the entry on record as Central Knot’s (a stop here leaves it so), and the next pass removes it, so Claude Code has it through the plugin alone', async () => {
  const box = await sandbox();
  try {
    await ownBesidePlugin(box, ['-y', 'issues-mcp']);
    await setSyncEverything(box.context, true);
    await backgroundPass(box);
    const item = (await box.view()).library.issues;
    assert.deepEqual([await argsIn(box, 'claude-cli', 'issues'), item.applied['claude-cli']], [['-y', 'issues-mcp'], item.hash]);
    await backgroundPass(box);
    assert.deepEqual([await argsIn(box, 'claude-cli', 'issues'), Object.keys((await box.row('issues'))?.plugin ?? {})], [undefined, ['claude-cli']]);
    assert.equal((await backgroundPass(box)).writes, 0);
  } finally { await box.cleanup(); }
});

/** As ownBesidePlugin with an entry of Claude Code's own that differs, and Copilot CLI's copy chosen, as the copy question sends it. */
async function chosenBesidePlugin(box: Box) {
  await ownBesidePlugin(box, ['-y', 'my-issues-mcp']);
  await box.send({ key: 'issues', on: true, except: [], seenOn: false, use: 'copilot-cli', useHash: (await box.row('issues'))!.copies['copilot-cli']!.hash });
  return (await readHistory(box.context)).find(event => event.kind === 'chosen')!;
}

test('Copilot CLI’s copy chosen where Claude Code has that server through a plugin and another entry of its own: Claude Code’s entry is kept as a version, as History says, and the next pass removes it', async () => {
  const box = await sandbox();
  try {
    const chosen = await chosenBesidePlugin(box), item = (await box.view()).library.issues;
    assert.equal(librarySentence(chosen, libraryWords.mcp, all, item)?.text, 'You chose Copilot CLI’s copy; Claude Code’s is kept as a version.');
    assert.deepEqual(item.versions.map(version => [version.from.how, version.from.harness]), [['was-in', 'claude-cli'], ['chosen', 'copilot-cli']]);
    assert.deepEqual([chosen.losers.map(loser => loser.tool), item.versions.some(version => version.hash === chosen.losers[0].hash)], [['claude-cli'], true]);
    assert.deepEqual(await argsIn(box, 'claude-cli', 'issues'), ['-y', 'my-issues-mcp'], 'nothing is written there');
    await backgroundPass(box);
    assert.deepEqual([await argsIn(box, 'claude-cli', 'issues'), Object.keys((await box.row('issues'))?.plugin ?? {})], [undefined, ['claude-cli']]);
    assert.equal((await backgroundPass(box)).writes, 0);
  } finally { await box.cleanup(); }
});

test('Copilot CLI’s copy chosen there, then its Undo before the next pass: Claude Code’s own entry stays where it was, as it was, and is its own again', async () => {
  const box = await sandbox();
  try {
    const chosen = await chosenBesidePlugin(box), claude = (await box.files())['claude-cli'];
    assert.equal(libraryAction(chosen, (await box.view()).library.issues, settled)?.label, 'Undo');
    assert.equal((await restoreServer(box.context, all, chosen.id)).stopped, undefined);
    assert.deepEqual([(await box.files())['claude-cli'], await commandIn(box, 'copilot-cli', 'issues'), await commandIn(box, 'codex-cli', 'issues')], [claude, 'npx', undefined]);
    assert.equal((await backgroundPass(box)).writes, 0);
  } finally { await box.cleanup(); }
});

test('Off takes the entry out of every tool in one pass, Claude Code’s too; On puts each back with its own fields, every file byte for byte', async () => {
  const box = await sandbox();
  try {
    await docsEverywhere(box);
    await box.send(on('docs'));
    const before = await box.files();
    const offDone = await box.send(off('docs'));
    assert.deepEqual(offDone.results.filter(entry => entry.outcome === 'removed').map(entry => entry.harness), all);
    const offFiles = await box.files();
    for (const tool of all) assert.equal(await commandIn(box, tool), undefined, `${tool} no longer has it`);
    assert.equal(offFiles['claude-cli'], `${JSON.stringify({ numStartups: 7, mcpServers: {}, projects: { '/x': {} } }, null, 2)}\n`, 'Claude Code’s other settings stay');
    assert.equal(offFiles['codex-cli'], 'model = "gpt-6"\n# mine\n\n[profiles.work]\nmodel = "o3"\n', 'Codex’s other tables and comments stay');

    const onDone = await box.send({ ...on('docs'), seenOn: false });
    assert.deepEqual(onDone.results.filter(entry => entry.outcome === 'written').map(entry => entry.harness), all);
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

test('A tool installed later gets an On server from the pass of the whole home, and the Caught up band names the server and that tool alone, once; an edit spread is its notice’s to tell', async () => {
  const box = await sandbox();
  try {
    const before: HarnessId[] = ['claude-cli', 'copilot-cli', 'codex-cli'], withPi: HarnessId[] = [...before, 'pi-cli'];
    await writeFile(box.path('copilot-cli'), `${JSON.stringify({ mcpServers: { docs: { type: 'local', command: 'npx', args: ['-y', 'docs'] } } }, null, 2)}\n`);
    // Add: the click writes docs into Claude Code and Codex.
    await box.send(on('docs'), before);
    // Pi is installed: the next pass writes docs there by itself. The band names Pi, not Claude Code nor Codex (the click's own
    // writes).
    const pass = async () => (await homePass(box.context, withPi, true)).synced!;
    const installed = await pass();
    assert.deepEqual(bandAfter(installed), { items: ['docs'], tools: ['pi-cli'] });
    assert.deepEqual(passTells(installed).copies.map(result => [result.harness, result.outcome]), [['pi-cli', 'written']]);
    assert.equal(await commandIn(box, 'pi-cli'), 'npx');
    // A pass with nothing to write tells nothing: the next view has no band.
    assert.deepEqual(bandAfter(await pass()), { items: [], tools: [] });
    // An edit in Copilot CLI spreads to Codex and Pi: the Library's notice says so, so the band leaves docs out.
    await writeFile(box.path('copilot-cli'), (await box.files())['copilot-cli']!.replace('"docs"\n', '"docs",\n        "--v2"\n'));
    const edited = await pass();
    assert.deepEqual([edited.servers?.notices?.map(itemNotice).map(notice => notice.kind), await argsIn(box, 'pi-cli')], [['edit'], ['-y', 'docs', '--v2']]);
    assert.deepEqual(bandAfter(edited), { items: [], tools: [] });
  } finally { await box.cleanup(); }
});

/**
 * Runs `pass` with Claude Code's settings file unreadable, so the pass neither reads nor writes it: what it decides is recorded,
 * and Claude Code's entry stays as it was, still applied there. That is the record and the file alpha 2 left wherever Claude
 * Code's write or removal waited for its Write to Claude Code (it planned Claude Code as any tool and left that one step
 * undone, marking nothing): this build's first pass is what such a home meets.
 */
async function claudeLeftOwed<T>(box: Box, pass: () => Promise<T>) {
  await fs.chmod(box.path('claude-cli'), 0o000);
  try { return await pass(); } finally { await fs.chmod(box.path('claude-cli'), 0o644); }
}

test('Sync once reports an unreadable owed removal and counts it as done only when the tool can be read again', async () => {
  const box = await sandbox(), tools = settled.managed;
  try {
    await writeFile(box.path('claude-cli'), JSON.stringify({ mcpServers: { docs: { command: 'docs' } } }));
    await box.send(on('docs'), tools);
    await writeFile(box.path('copilot-cli'), '{"mcpServers":{}}');
    const pass = async () => (await homePass(box.context, tools, true)).synced!;
    const first = await claudeLeftOwed(box, pass);
    // What it did is its sentence, which says first that not everything was synced; what it couldn't do is a reason of its own.
    const result = syncOnceReport([first]);
    assert.equal(result.warn, true);
    assert.equal(result.text, 'Not everything was synced. Removed docs from Codex.');
    assert.equal(result.reasons.length, 1);
    assert.deepEqual(result.reasons[0]?.[0], 'docs');
    assert.match(result.reasons[0]![1]!, /^ \(Claude Code\): .*could not be read\.$/);
    assert.deepEqual(syncOnceReport([first, await pass()]), {
      text: 'Removed docs from Codex and Claude Code.', reasons: [], warn: false, history: false,
    });
  } finally { await box.cleanup(); }
});

test('Sync once: one item refused in two tools is two reasons, each its item, then its tool and what failed, as the Library draws them; what it did is its sentence', () => {
  const refused = (harness: 'claude-cli' | 'copilot-cli') => ({ item: 'docs', harness, outcome: 'failed' as const, removal: true, message: 'Its file couldn’t be written.' });
  assert.deepEqual(syncOnceReport([{ crashes: [], servers: { writes: 1, results: [{ item: 'docs', harness: 'codex-cli', outcome: 'removed', message: '' }, refused('claude-cli'), refused('copilot-cli')] } }]), {
    text: 'Not everything was synced. Removed docs from Codex.', warn: true, history: false,
    reasons: [['docs', ' (Claude Code): Its file couldn’t be written.'], ['docs', ' (Copilot CLI): Its file couldn’t be written.']],
  });
});

test('A home alpha 2 left with Claude Code’s steps owed: the first pass takes a server turned Off out of Claude Code, and one deleted, by its tombstone', async () => {
  const box = await sandbox();
  try {
    await writeFile(box.path('claude-cli'), `${JSON.stringify({ numStartups: 2, mcpServers: { docs: { type: 'stdio', command: 'npx' }, web: { type: 'stdio', command: 'web' } } }, null, 2)}\n`);
    await box.send(on('docs'));
    await box.send(on('web'));
    await claudeLeftOwed(box, async () => {
      await box.send(off('docs'));
      await box.send({ key: 'web', on: false, except: [], seenOn: true, deleted: true });
    });
    const owed = await box.view();
    assert.deepEqual([(await readTool(box.context, 'claude-cli')).entries.map(entry => entry.name), owed.library.docs.on, !!owed.library.web.deleted], [['docs', 'web'], false, true]);
    const pass = await applyServers(box.context, all, []);
    assert.deepEqual(pass.results.map(result => [result.item, result.harness, result.outcome]), [['docs', 'claude-cli', 'removed'], ['web', 'claude-cli', 'removed']]);
    assert.equal((await box.files())['claude-cli'], `${JSON.stringify({ numStartups: 2, mcpServers: {} }, null, 2)}\n`, 'its other settings stay');
    const view = await box.view(), row = view.items.find(item => item.key === 'docs')!;
    assert.deepEqual(view.items.map(item => item.key), ['docs'], 'web is gone from the page too');
    assert.equal(statusLine({ ...row, hashes: hashes(row) }, view.library.docs, view.tools), 'Off · in Central Knot only. Turn it on to put it in every tool.');
    // Each removal is History's rule for a pass no click asked for (`in-line`); the Delete's own entry keeps its Restore.
    const history = await readHistory(box.context);
    assert.deepEqual(history.slice(-2).map(event => [event.key, event.kind, event.cause, event.losers.map(loser => loser.tool)]), [['mcp:docs', 'off', 'in-line', ['claude-cli']], ['mcp:web', 'deleted', 'in-line', ['claude-cli']]]);
    const deleted = history.find(event => event.key === 'mcp:web' && event.kind === 'deleted' && !event.cause)!;
    assert.equal(libraryAction(deleted, view.library.web, settled)?.label, 'Restore');
  } finally { await box.cleanup(); }
});
const hashes = (row: LibraryFacts) => Object.fromEntries(Object.entries(row.copies).map(([tool, copy]) => [tool, copy!.hash]));

test('`codex mcp remove` of Codex’s only server turns it Off everywhere; Central Knot keeps it, and History’s Turn it on puts each entry back', async () => {
  const box = await sandbox();
  try {
    await writeFile(box.path('codex-cli'), 'model = "gpt-6"\n\n[mcp_servers.docs]\ncommand = "npx"\nargs = ["-y", "docs"]\n');
    await box.send(on('docs'));
    assert.equal(await commandIn(box, 'copilot-cli'), 'npx');
    // What `codex mcp remove docs` leaves: no servers table at all.
    await writeFile(box.path('codex-cli'), 'model = "gpt-6"\n');
    const pass = await applyServers(box.context, all, []);
    assert.deepEqual(pass.notices?.map(itemNotice).map(notice => [notice.kind, notice.winner]), [['deleted-by-hand', 'codex-cli']]);
    for (const tool of all.slice(1)) assert.equal(await commandIn(box, tool), undefined, `${tool}: Off everywhere`);
    const view = await box.view();
    assert.deepEqual([view.items[0]?.on, view.library.docs.versions.length], [false, 1]);
    const entry = (await readHistory(box.context)).find(event => event.cause === 'deleted-by-hand')!;
    assert.equal(libraryAction(entry, view.library.docs, settled)?.label, 'Turn it on');
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
    await box.send({ ...on('docs'), seenOn: false });
    await applyServers(slow, all, [], { now: at + 9000 });
    await box.send({ ...on('more'), seenOn: false });
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

test('An entry seen again in part ends its absence: back as no server at the reread, later gone again for a moment, it turns nothing Off', async () => {
  const box = await sandbox();
  try {
    const whole = JSON.stringify({ mcpServers: { docs: { type: 'local', command: 'npx' } } });
    await writeFile(box.path('copilot-cli'), whole);
    await box.send(on('docs'));
    const waiting = { ...box.context, settleMs: 2000 };
    await writeFile(box.path('copilot-cli'), '{ "mcpServers": {} }\n');
    assert.equal((await applyServers(waiting, all, [], { now: 1000 })).settling, true);
    await writeFile(box.path('copilot-cli'), '{ "mcpServers": { "docs": null } }\n');
    await applyServers(waiting, all, [], { now: 3500 });
    await writeFile(box.path('copilot-cli'), '{ "mcpServers": {} }\n');
    const brief = await applyServers(waiting, all, [], { now: 300_000 });
    assert.deepEqual([brief.settling, (await box.row('docs'))?.on, await commandIn(box, 'codex-cli')], [true, true, 'npx']);
    await writeFile(box.path('copilot-cli'), whole);
    await applyServers(waiting, all, [], { now: 303_000 });
    assert.deepEqual([(await box.row('docs'))?.on, await commandIn(box, 'codex-cli')], [true, 'npx']);
  } finally { await box.cleanup(); }
});

test('A click on another server reads this one too: that read starts no window for it, and seen there in part, its window ends', async () => {
  const box = await sandbox();
  try {
    const more = { type: 'local', command: 'more' };
    await writeFile(box.path('copilot-cli'), JSON.stringify({ mcpServers: { docs: { type: 'local', command: 'npx' }, more } }));
    await box.send(on('docs'));
    await box.send(on('more'));
    // Automatic sync off: a click on more alone is a pass for more alone.
    const waiting = { ...box.context, settleMs: 2000 }, clickMore = (now: number) => applyServers(waiting, all, [on('more')], { now, only: new Set(['more']) });
    const without = JSON.stringify({ mcpServers: { more } });
    await writeFile(box.path('copilot-cli'), without);
    await clickMore(1000);
    assert.equal((await applyServers(waiting, all, [], { now: 3000 })).settling, true, 'the click started no window for docs: the full pass starts it');
    await writeFile(box.path('copilot-cli'), JSON.stringify({ mcpServers: { docs: null, more } }));
    await clickMore(3500);
    await writeFile(box.path('copilot-cli'), without);
    const brief = await applyServers(waiting, all, [], { now: 300_000 });
    assert.deepEqual([brief.settling, (await box.row('docs'))?.on, await commandIn(box, 'codex-cli')], [true, true, 'npx']);
  } finally { await box.cleanup(); }
});

test('A settings file whose look fails for another reason than “not there” starts no window: deleted after, it gets the whole window', { skip: process.getuid?.() === 0 }, async () => {
  const box = await sandbox();
  try {
    await writeFile(box.path('copilot-cli'), JSON.stringify({ mcpServers: { docs: { type: 'local', command: 'npx' } } }));
    await box.send(on('docs'));
    // As in this computer's own home: a folder opened as home that can't be looked into is preview only (share.ts writeAccess).
    const waiting: ShareContext = { ...box.context, mode: 'actual', realHome: box.home, allowActualWrites: true, settleMs: 2000 };
    const codex = join(box.home, '.codex');
    await chmod(codex, 0o000);
    try { assert.equal((await applyServers(waiting, all, [], { now: 1000 })).settling, false); } finally { await chmod(codex, 0o755); }
    await rm(box.path('codex-cli'));
    const away = await applyServers(waiting, all, [], { now: 3500 });
    assert.deepEqual([away.settling, await commandIn(box, 'codex-cli')], [true, undefined], 'really missing now: its window starts now');
    await applyServers(waiting, all, [], { now: 6000 });
    assert.deepEqual([await commandIn(box, 'codex-cli'), (await box.row('docs'))?.on], ['npx', true], 'past it, written afresh');
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
    // An edit in Codex: the current version, in every tool, Claude Code's too.
    await writeFile(box.path('codex-cli'), (await box.files())['codex-cli']!.replace('args = ["-y", "docs"]', 'args = ["-y", "docs", "--v2"]'));
    const edited = await applyServers(box.context, all, []);
    assert.deepEqual(edited.notices?.map(itemNotice).map(notice => [notice.kind, notice.winner]), [['edit', 'codex-cli']]);
    for (const tool of ['claude-cli', 'copilot-cli', 'pi-cli', 'opencode-cli'] as const) assert.deepEqual(await argsIn(box, tool), ['-y', 'docs', '--v2'], tool);
    assert.equal(JSON.parse((await box.files())['copilot-cli']!).mcpServers.docs.timeout, 99, 'Copilot keeps its own field');
    assert.equal(JSON.parse((await box.files())['claude-cli']!).mcpServers.docs.timeout, 30, 'and Claude Code its own');
    // Two edits in one pass: an entry has no time of its own, so the first tool's wins and the other is a version.
    await writeFile(box.path('pi-cli'), (await box.files())['pi-cli']!.replace('"--v2"', '"--pi"'));
    await writeFile(box.path('opencode-cli'), (await box.files())['opencode-cli']!.replace('"--v2"', '"--opencode"'));
    const both = await applyServers(box.context, all, []);
    assert.deepEqual(both.notices?.map(itemNotice).map(notice => [notice.kind, notice.winner, notice.losers]), [['conflict', 'pi-cli', ['opencode-cli']]]);
    assert.deepEqual(await argsIn(box, 'opencode-cli'), ['-y', 'docs', '--pi']);
    assert.ok((await box.view()).library.docs.versions.some(version => version.from.how === 'edited' && version.from.harness === 'opencode-cli'));
  } finally { await box.cleanup(); }
});

test('What is never taken in says why and offers nothing: a server that belongs to an app, a form Central Knot doesn’t edit, two names that differ only by case, a plugin’s part waiting to be moved to the library', async () => {
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
      part: [1, 'A plugin’s part of this name is waiting to be moved to the library, so nothing changes here until it is.'],
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
    const settle = async () => { await applyServers(box.context, all, []); await applyServers(box.context, all, []); };
    await claude({ type: 'stdio', command: 'version-1' });
    await box.send(on('docs'));
    const first = (await box.view()).library.docs.hash;
    await claude({ type: 'stdio', command: 'version-2' }); await settle();
    await claude({ type: 'sse', url: 'https://docs.example/sse' }); await settle();
    assert.equal(await commandIn(box, 'codex-cli'), 'version-2', 'Codex keeps the copy it can hold');
    // Make current version-1: a click's own pass, as with Automatic sync off.
    await applyServers(box.context, all, [{ ...asItIs('docs', (await box.view()).library.docs), version: first }], { only: new Set(['docs']) });
    assert.deepEqual([await commandIn(box, 'codex-cli'), await commandIn(box, 'pi-cli'), (await box.row('docs'))?.cannot], ['version-1', 'version-1', {}]);
  } finally { await box.cleanup(); }
});

test('A tool’s own switch is left as it is: set in each tool by hand, then Off and On; the switch inside Codex’s and OpenCode’s entries comes back with it, Claude Code’s stays in its settings', async () => {
  const box = await sandbox();
  try {
    const tools: HarnessId[] = ['claude-cli', 'codex-cli', 'opencode-cli'];
    box.context.read = () => Promise.all(tools.map(harness => discover({ home: box.home, mode: 'custom', harness })));
    await writeFile(box.path('claude-cli'), `${JSON.stringify({ mcpServers: { docs: { type: 'stdio', command: 'npx' } } }, null, 2)}\n`);
    // OpenCode's newer line keeps it under `mcp.servers`, where its switch is `disabled`.
    await writeFile(box.path('opencode-cli'), `${JSON.stringify({ mcp: { servers: { docs: { type: 'local', command: ['npx'] } } } }, null, 2)}\n`);
    await writeFile(join(box.home, '.claude/settings.json'), '{\n  "theme": "dark"\n}\n');
    await box.send(on('docs'), tools);
    // Switched off by hand: Codex's and OpenCode's switch in their entry, Claude Code's in its settings list.
    for (const tool of tools) await writeFile(mcpSwitchPath(box.context, tool), withMcpSwitch(tool, await readFile(mcpSwitchPath(box.context, tool), 'utf8'), 'docs', true));
    let view = await serversView(box.context, tools);
    assert.deepEqual(view.items[0]?.switchedOff, ['claude-cli', 'codex-cli', 'opencode-cli']);
    const switchedOff = view.items[0]?.switchedOff;
    assert.match(say.harnessLine({ key: 'docs', hashes: { 'codex-cli': 'x' }, plan: { orderProved: true, current: ['codex-cli'], write: [], remove: [], forget: [], ownCopy: [], keep: [] }, switchedOff }, view.library.docs, 'codex-cli', 'Codex'),
      /It is switched off in Codex’s own settings: Codex doesn’t start it\. Central Knot leaves that switch as it is, so it is still off there after Off and On\./);
    assert.equal(say.placeTag({ key: 'docs', switchedOff }, view.library.docs, tools)?.title,
      'Switched off in Claude Code’s own settings, switched off in Codex’s own settings and switched off in OpenCode’s own settings: each tool’s own switch, which Central Knot leaves as it is. Turn it back on in that tool’s own settings.');
    // Off: out of every tool (Codex's own fields kept, the switch with them); Claude Code's switch is in its settings, not the entry.
    await box.send(off('docs'), tools);
    assert.equal(await commandIn(box, 'codex-cli'), undefined);
    // On: Codex's and OpenCode's entries come back as they were, each where it was and switched off in its own fields; the row
    // says so. Claude Code's switch was never touched.
    await box.send({ ...on('docs'), seenOn: false }, tools);
    assert.match((await box.files())['codex-cli']!, /\[mcp_servers\.docs\]\ncommand = "npx"\nenabled = false\n/);
    assert.deepEqual(JSON.parse((await box.files())['opencode-cli']!).mcp, { servers: { docs: { type: 'local', command: ['npx'], disabled: true } } });
    assert.match(await readFile(join(box.home, '.claude/settings.json'), 'utf8'), /"serverName": "docs"/);
    view = await serversView(box.context, tools);
    assert.deepEqual([view.items[0]?.on, view.items[0]?.switchedOff], [true, ['claude-cli', 'codex-cli', 'opencode-cli']]);
  } finally { await box.cleanup(); }
});

test('Taking in a server Claude Code had has its Undo, as any tool’s: Claude Code keeps its own entry, byte for byte, and the tools it was put in lose it', async () => {
  const box = await sandbox();
  try {
    const claude = JSON.stringify({ numStartups: 4, mcpServers: { docs: { type: 'stdio', command: 'npx', args: ['docs'], timeout: 39 } } });
    await writeFile(box.path('claude-cli'), claude);
    await box.send(on('docs'));
    assert.equal(await commandIn(box, 'copilot-cli'), 'npx');
    const add = (await readHistory(box.context)).find(event => event.kind === 'on' && event.cause === 'found')!;
    assert.equal(libraryAction(add, (await box.view()).library.docs, settled)?.label, 'Undo');
    assert.equal((await restoreServer(box.context, all, add.id)).stopped, undefined);
    assert.equal((await box.files())['claude-cli'], claude);
    for (const tool of all.slice(1)) assert.equal(await commandIn(box, tool), undefined, `${tool} no longer has it`);
    assert.deepEqual((await box.view()).items.map(item => [item.key, item.on, Object.keys(item.copies)]), [['docs', false, ['claude-cli']]], 'found again, in Claude Code');
  } finally { await box.cleanup(); }
});

test('With Automatic sync off, what Claude Code is owed waits for Sync once or a click on its row, as any tool’s: a home alpha 2 left so is not written by its first pass', async () => {
  const box = await sandbox();
  try {
    await writeFile(box.path('copilot-cli'), JSON.stringify({ mcpServers: { a: { type: 'local', command: 'a' }, b: { type: 'local', command: 'b' } } }));
    await writeFile(box.path('claude-cli'), '{}');
    await claudeLeftOwed(box, () => applyServers(box.context, all, [on('a'), on('b')]));
    const inClaude = async () => (await readTool(box.context, 'claude-cli')).entries.map(entry => entry.name);
    // main.ts runs the kinds' passes only with Automatic sync on, or at Sync once.
    await homePass(box.context, all, false);
    assert.deepEqual(await inClaude(), []);
    // A click on a's row: a pass for a alone.
    await applyServers(box.context, all, [asItIs('a', (await box.view()).library.a)], { only: new Set(['a']) });
    assert.deepEqual(await inClaude(), ['a']);
    // Sync once: the rest.
    await homePass(box.context, all, true);
    assert.deepEqual(await inClaude(), ['a', 'b']);
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
    await box.send({ ...on('github'), seenOn: false });
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
    await box.send({ ...on('docs'), seenOn: false }, tools);
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

// ---------- Saves that land meanwhile, a crash in a write, and entries in less common forms ----------

/** Runs `body` in a fresh home (sandbox), cleaned up after. */
async function inBox(body: (box: Box) => Promise<void>) {
  const box = await sandbox();
  try { await body(box); } finally { await box.cleanup(); }
}
const three: HarnessId[] = ['claude-cli', 'copilot-cli', 'codex-cli'], copilotAndCodex: HarnessId[] = ['copilot-cli', 'codex-cli'];
/** A settings file whose one server, docs, runs `command`. */
const docsRuns = (command: string) => JSON.stringify({ mcpServers: { docs: { command } } });
/** Checks a TOML text with an independent parser (Python 3.11+); where none is installed (the Mac's Python 3.9), it is skipped. */
function validToml(text: string) {
  const parsed = spawnSync('python3', ['-c', 'import sys,tomllib; tomllib.loads(sys.stdin.read())'], { input: text, encoding: 'utf8' });
  if (/No module named 'tomllib'|ENOENT/.test(`${parsed.stderr ?? ''}${parsed.error?.message ?? ''}`)) return;
  assert.equal(parsed.status, 0, `${parsed.stderr}\n${text}`);
}

test('An edit saved in a tool while the pass writes its file is never written over: Codex’s own switch set meanwhile stays', () => inBox(async box => {
  const target = box.path('codex-cli');
  await fs.writeFile(box.path('copilot-cli'), docsRuns('BASE'));
  await fs.writeFile(target, '[mcp_servers.docs]\ncommand="BASE"\nenabled=true\n');
  await applyServers(box.context, copilotAndCodex, [on('docs')]);
  await fs.writeFile(box.path('copilot-cli'), docsRuns('EDIT'));
  const original = fs.readFile; let reads = 0;
  fs.readFile = (async (path: unknown, ...rest: unknown[]) => {
    if (String(path) === target && ++reads === 2) await fs.writeFile(target, '[mcp_servers.docs]\ncommand="BASE"\nenabled=false\n');
    return (original as (...args: unknown[]) => Promise<unknown>)(path, ...rest);
  }) as typeof fs.readFile; syncBuiltinESMExports();
  try { await applyServers(box.context, copilotAndCodex, []); } finally { fs.readFile = original; syncBuiltinESMExports(); }
  assert.match(await fs.readFile(target, 'utf8'), /enabled=false/, 'the switch set meanwhile is kept');
}));

test('An Undo whose file is saved again right after its write keeps that save: it is taken in, not overwritten', () => inBox(async box => {
  const target = box.path('copilot-cli');
  await fs.writeFile(target, docsRuns('BASE')); await applyServers(box.context, copilotAndCodex, [on('docs')]);
  await fs.writeFile(target, docsRuns('EDIT')); await applyServers(box.context, copilotAndCodex, []);
  const event = (await readHistory(box.context)).find(entry => entry.kind === 'edit')!;
  const original = fs.link; let injected = false;
  fs.link = async (from, to) => { await original(from, to); if (String(to) === target && !injected) { injected = true; await fs.writeFile(target, docsRuns('CONCURRENT')); } }; syncBuiltinESMExports();
  try { await restoreServer(box.context, copilotAndCodex, event.id); } finally { fs.link = original; syncBuiltinESMExports(); }
  await applyServers(box.context, copilotAndCodex, []);
  assert.equal(await commandIn(box, 'copilot-cli'), 'CONCURRENT');
}));

test('A crash inside the checked write of a linked config.toml: the next pass puts the file back behind its link', () => inBox(async box => {
  const codex = box.path('codex-cli'), target = join(box.home, 'dotfiles/config.toml');
  await fs.mkdir(join(box.home, 'dotfiles'));
  await fs.writeFile(target, 'model="gpt-5"\n[mcp_servers.docs]\ncommand="BASE"\n');
  await fs.symlink(target, codex);
  await fs.writeFile(box.path('copilot-cli'), docsRuns('BASE'));
  await applyServers(box.context, copilotAndCodex, [on('docs')]);
  await fs.writeFile(box.path('copilot-cli'), docsRuns('EDIT'));
  const script = `import fs from 'node:fs/promises';import {syncBuiltinESMExports} from 'node:module';import {applyServers} from './src/servers.ts';
    const original=fs.link;fs.link=async(from,to)=>{if(String(to)===process.env.CK_TARGET)process.exit(73);return original(from,to);};syncBuiltinESMExports();
    const context=JSON.parse(process.env.CK_CONTEXT);context.read=async()=>[];await applyServers(context,['copilot-cli','codex-cli'],[]);`;
  const child = spawnSync(process.execPath, ['--input-type=module', '-e', script], { cwd: process.cwd(), env: { ...process.env, CK_TARGET: await fs.realpath(target), CK_CONTEXT: JSON.stringify(box.context) }, encoding: 'utf8' });
  assert.equal(child.status, 73, child.stderr);
  await applyServers(box.context, copilotAndCodex, []);
  assert.equal((await readTool(box.context, 'codex-cli')).exists, true, `the link leads nowhere; dotfiles holds ${await fs.readdir(join(box.home, 'dotfiles'))}`);
  assert.ok((await fs.lstat(codex)).isSymbolicLink(), 'config.toml is still a link, not a file in its place');
}));

test('A pass that can’t write one tool’s file says so and goes on: it never throws', () => inBox(async box => {
  await fs.writeFile(box.path('copilot-cli'), JSON.stringify({ mcpServers: { a: { type: 'local', command: 'A' }, b: { type: 'local', command: 'B' } } }));
  await fs.writeFile(box.path('codex-cli'), '');
  await applyServers(box.context, copilotAndCodex, [on('a'), on('b')]);
  await fs.writeFile(box.path('copilot-cli'), JSON.stringify({ mcpServers: { a: { type: 'local', command: 'A2' }, b: { type: 'local', command: 'B2' } } }));
  await fs.chmod(join(box.home, '.codex'), 0o555);
  let threw: unknown;
  try { await applyServers(box.context, copilotAndCodex, []); } catch (error) { threw = error; } finally { await fs.chmod(join(box.home, '.codex'), 0o755); }
  assert.equal(threw, undefined, `the pass threw instead of reporting a held write: ${threw}`);
}));

test('An entry deleted by hand turns the server Off, sparing a same-named server Central Knot never had; Claude Code’s copy goes in the same pass', () => inBox(async box => {
  await fs.writeFile(box.path('claude-cli'), docsRuns('BASE'));
  await applyServers(box.context, three.slice(0, 2), [on('docs')]);
  await fs.writeFile(box.path('codex-cli'), '[mcp_servers.docs]\ncommand="UNRELATED"\n');
  await fs.writeFile(box.path('copilot-cli'), '{"mcpServers":{}}');
  await applyServers(box.context, three, [], { settleMs: 0 });
  assert.deepEqual([await commandIn(box, 'codex-cli'), await commandIn(box, 'claude-cli')], ['UNRELATED', undefined]);
}));

test('History’s Turn it on after an entry was deleted by hand in Codex gives it back with Codex’s own switch as it was (enabled = false)', () => inBox(async box => {
  const codex = box.path('codex-cli');
  await fs.writeFile(box.path('copilot-cli'), docsRuns('BASE'));
  await applyServers(box.context, copilotAndCodex, [on('docs')]);
  await fs.writeFile(codex, (await fs.readFile(codex, 'utf8')).replace('command = "BASE"\n', 'command = "BASE"\nenabled = false\n'));
  await applyServers(box.context, copilotAndCodex, []);
  await fs.writeFile(codex, '[mcp_servers.other]\ncommand = "true"\n');
  await applyServers(box.context, copilotAndCodex, [], { settleMs: 0 });
  await restoreServer(box.context, copilotAndCodex, (await readHistory(box.context)).find(entry => entry.kind === 'off' && entry.cause === 'deleted-by-hand')!.id);
  assert.match(await fs.readFile(codex, 'utf8'), /enabled\s*=\s*false/);
}));

test('Claude Code making .claude.json again without its servers turns each Off everywhere: nothing is lost, and each is one click back on', () => inBox(async box => {
  const claude = box.path('claude-cli');
  const servers = { docs: { type: 'stdio', command: 'docs-mcp' }, web: { type: 'stdio', command: 'web-mcp' } };
  await fs.writeFile(claude, JSON.stringify({ numStartups: 3, mcpServers: servers }));
  await applyServers(box.context, three, [on('docs'), on('web')]);
  assert.ok((await readTool(box.context, 'codex-cli')).entries.length === 2);
  // Claude Code replaces its file (atomic write) with a fresh one: no missing window. A file that reads and no longer has an
  // entry is a deletion by hand, in every format; there is no test for a "reset".
  await fs.writeFile(`${claude}.new`, JSON.stringify({ numStartups: 1, firstStartTime: 'now' }));
  await fs.rename(`${claude}.new`, claude);
  await applyServers(box.context, three, [], { settleMs: 0 });
  assert.deepEqual((await readTool(box.context, 'codex-cli')).entries.map(entry => entry.name), []);
  const view = await serversView(box.context, three);
  assert.deepEqual(view.items.map(item => [item.key, item.on]), [['docs', false], ['web', false]], 'each is Off, in Central Knot only');
  await applyServers(box.context, three, [{ key: 'docs', on: true, except: [], seenOn: false }]);
  assert.deepEqual([(await readTool(box.context, 'codex-cli')).entries.map(entry => entry.server.command), (await readTool(box.context, 'claude-cli')).entries.map(entry => entry.server.command)], [['docs-mcp'], ['docs-mcp']]);
}));

test('Two tools’ entries edited between passes have no time to order them: History and the notice say the times can’t tell, never that the first tool’s was the latest', () => inBox(async box => {
  await fs.writeFile(box.path('copilot-cli'), docsRuns('BASE'));
  await applyServers(box.context, copilotAndCodex, [on('docs')]);
  await fs.writeFile(box.path('copilot-cli'), docsRuns('COPILOT-EDIT'));
  await fs.writeFile(box.path('codex-cli'), '[mcp_servers.docs]\ncommand = "CODEX-EDIT"\n');
  const met = itemNotice((await applyServers(box.context, copilotAndCodex, [])).notices![0]);
  // Copilot CLI's edit is the current version because Copilot CLI comes first among the tools, not because it was later.
  assert.deepEqual([met.kind, met.winner, met.losers, met.orderProved, await commandIn(box, 'codex-cli')], ['conflict', 'copilot-cli', ['codex-cli'], false, 'COPILOT-EDIT']);
  assert.equal(say.noticeWords(met).text, 'docs: Copilot CLI’s edit is the current version, though the times can’t tell which edit came last. Codex’s is kept as a version.');
  const entry = (await readHistory(box.context)).find(event => event.kind === 'conflict')!;
  assert.equal(entry.orderProved, false);
  assert.equal(librarySentence(entry, libraryWords.mcp, copilotAndCodex)?.text, 'Copilot CLI’s edit became the current version, though the times can’t tell which edit came last. Codex’s is kept as a version.');
}));

test('Claude Code’s write owed (as alpha 2 left it) while its entry is edited by hand and Copilot CLI and Codex edit theirs: no time decided, as History says, and each is written', () => inBox(async box => {
  const docs = (command: string) => JSON.stringify({ mcpServers: { docs: { type: 'stdio', command } } });
  await fs.writeFile(box.path('claude-cli'), docs('BASE'));
  await applyServers(box.context, three, [on('docs')]);
  await fs.writeFile(box.path('copilot-cli'), docsRuns('COPILOT-1'));
  await claudeLeftOwed(box, () => applyServers(box.context, three, [])); // Codex gets it; Claude Code's write is owed
  await fs.writeFile(box.path('claude-cli'), docs('CLAUDE-EDIT'));
  await fs.writeFile(box.path('copilot-cli'), docsRuns('COPILOT-2'));
  await fs.writeFile(box.path('codex-cli'), '[mcp_servers.docs]\ncommand = "CODEX-2"\n');
  const told = (await readHistory(box.context)).length;
  await applyServers(box.context, three, []);
  const met = (await readHistory(box.context)).slice(told);
  // Copilot CLI's edit is taken in by the tools' order; Claude Code's and Codex's are kept, and both are written, in one entry.
  assert.deepEqual(met.map(event => [event.kind, event.winner?.tool, event.orderProved, event.losers.map(loser => loser.tool)]), [['conflict', 'copilot-cli', false, ['claude-cli', 'codex-cli']]]);
  assert.match(librarySentence(met[0], libraryWords.mcp, three)!.text, /^Copilot CLI’s edit became the current version, though the times can’t tell which edit came last\./);
  assert.deepEqual([await commandIn(box, 'codex-cli'), await commandIn(box, 'claude-cli')], ['COPILOT-2', 'COPILOT-2']);
}));

test('Claude Code’s entry edited by hand while its write was owed (as alpha 2 left it) gives way to the current version: kept as a version, then written over, as History says', () => inBox(async box => {
  const docs = (command: string) => JSON.stringify({ mcpServers: { docs: { type: 'stdio', command } } });
  await fs.writeFile(box.path('claude-cli'), docs('BASE'));
  await applyServers(box.context, three, [on('docs')]);
  await fs.writeFile(box.path('copilot-cli'), docsRuns('COPILOT-1'));
  await claudeLeftOwed(box, () => applyServers(box.context, three, [])); // Codex gets it; Claude Code's write is owed
  await fs.writeFile(box.path('claude-cli'), docs('CLAUDE-EDIT'));
  const told = (await readHistory(box.context)).length;
  await applyServers(box.context, three, []);
  // An entry has no time of its own: an edit made where the current version had moved on loses to it, and is kept.
  const met = (await readHistory(box.context)).slice(told), view = await serversView(box.context, three);
  assert.deepEqual([met.map(event => [event.kind, event.losers.map(loser => loser.tool)]), await commandIn(box, 'claude-cli'), view.items[0]!.description], [[['kept-edit', ['claude-cli']]], 'COPILOT-1', 'Command · COPILOT-1']);
  assert.equal(librarySentence(met[0], libraryWords.mcp, three)?.text, 'Edited in Claude Code, not taken in yet; it gave way to the current version and is kept as a version.');
  assert.ok(view.library.docs.versions.some(version => version.from.how === 'edited' && version.from.harness === 'claude-cli'), 'Claude Code’s edit is a version');
}));

test('A removal Claude Code owes (as alpha 2 left it) goes to the file it was owed in, never to Claude Code’s settings moved somewhere else since', () => inBox(async box => {
  await fs.writeFile(box.path('claude-cli'), docsRuns('BASE'));
  await applyServers(box.context, three, [on('docs')]);
  await fs.writeFile(box.path('copilot-cli'), '{"mcpServers":{}}');
  await claudeLeftOwed(box, () => applyServers(box.context, three, [], { settleMs: 0 }));
  const alternate = join(box.home, 'alternate-claude');
  await fs.mkdir(alternate);
  await fs.writeFile(join(alternate, '.claude.json'), docsRuns('BASE'));
  await applyServers({ ...box.context, overrides: { 'claude-cli': alternate } }, three, []);
  assert.equal((await readTool({ ...box.context, overrides: { 'claude-cli': alternate } }, 'claude-cli')).entries[0]?.server.command, 'BASE');
}));

for (const broken of ['{"mcpServers":null}', '{"mcpServers":{"docs":null}}']) test(`A settings file holding ${broken} deletes nothing elsewhere: the other copies stay`, () => inBox(async box => {
  await fs.writeFile(box.path('copilot-cli'), docsRuns('BASE'));
  await applyServers(box.context, copilotAndCodex, [on('docs')]);
  await fs.writeFile(box.path('copilot-cli'), broken);
  await applyServers(box.context, copilotAndCodex, []);
  assert.equal((await readTool(box.context, 'codex-cli')).entries[0]?.server.command, 'BASE');
}));

for (const [name, initial] of [
  ['docs', 'model="gpt-5"\nmcp_servers = { docs = { command = "BASE" } }\n'],
  ['docs.v2', '[mcp_servers]\n"docs.v2" = { command = "BASE" }\n'],
]) {
  test(`A Codex server written inline (${name}) can’t be seen for sure there, so an edit never gives it a second definition`, () => inBox(async box => {
    validToml(initial);
    await fs.writeFile(box.path('codex-cli'), initial);
    await fs.writeFile(box.path('copilot-cli'), JSON.stringify({ mcpServers: { [name]: { command: 'BASE' } } }));
    await applyServers(box.context, copilotAndCodex, [on(name)]);
    await fs.writeFile(box.path('copilot-cli'), JSON.stringify({ mcpServers: { [name]: { command: 'EDIT' } } }));
    await applyServers(box.context, copilotAndCodex, []);
    assert.equal(await fs.readFile(box.path('codex-cli'), 'utf8'), initial);
    assert.match((await serversView(box.context, copilotAndCodex)).items[0]!.unseen?.['codex-cli'] ?? '', /not written in a form Central Knot edits/);
  }));
}

test('Codex’s dotted env fields are read, spread, and written back as valid TOML', () => inBox(async box => {
  await fs.writeFile(box.path('codex-cli'), '[mcp_servers.docs]\ncommand="BASE"\nenv.REGION="west"\n');
  await applyServers(box.context, copilotAndCodex, [on('docs')]);
  assert.deepEqual((await readTool(box.context, 'copilot-cli')).entries[0]?.server.env, { REGION: 'west' });
  await fs.writeFile(box.path('copilot-cli'), JSON.stringify({ mcpServers: { docs: { command: 'BASE', env: { REGION: 'east' } } } }));
  await applyServers(box.context, copilotAndCodex, []);
  assert.equal(await fs.readFile(box.path('codex-cli'), 'utf8'), '[mcp_servers.docs]\ncommand = "BASE"\n\n[mcp_servers.docs.env]\nREGION = "east"\n');
}));

test('Codex’s headers written as a table (http_headers) are read and kept', () => inBox(async box => {
  await fs.writeFile(box.path('codex-cli'), '[mcp_servers.docs]\nurl = "https://a.example/mcp"\n\n[mcp_servers.docs.http_headers]\nX-Team = "core"\n');
  const entry = (await readTool(box.context, 'codex-cli')).entries.find(each => each.name === 'docs')!;
  assert.deepEqual(entry.server.headers, { 'X-Team': 'core' }, 'headers in table form are read, so other tools get the server with them');
}));

test('An edit spread to Codex keeps the server’s own subtables there (env_http_headers, a tool’s approval)', () => inBox(async box => {
  await fs.writeFile(box.path('copilot-cli'), JSON.stringify({ mcpServers: { docs: { type: 'http', url: 'https://a.example/mcp', tools: ['*'] } } }));
  await fs.writeFile(box.path('codex-cli'), '[mcp_servers.docs]\nurl = "https://a.example/mcp"\nenabled = true\n\n[mcp_servers.docs.env_http_headers]\nX_REGION = "REGION_VAR"\n\n[mcp_servers.docs.tools.search]\napproval_mode = "approve"\n');
  await applyServers(box.context, copilotAndCodex, [on('docs')]);
  await fs.writeFile(box.path('copilot-cli'), JSON.stringify({ mcpServers: { docs: { type: 'http', url: 'https://b.example/mcp', tools: ['*'] } } }));
  await applyServers(box.context, copilotAndCodex, []);
  const text = await fs.readFile(box.path('codex-cli'), 'utf8');
  assert.match(text, /b\.example/, 'the edit spread');
  assert.match(text, /env_http_headers/, `Codex's own env_http_headers table is kept:\n${text}`);
  assert.match(text, /approval_mode/, `Codex's own per-tool table is kept:\n${text}`);
}));

test('A comment before the next table stays with that table when the server is written again', () => inBox(async box => {
  await fs.writeFile(box.path('copilot-cli'), JSON.stringify({ mcpServers: { docs: { type: 'local', command: 'A' } } }));
  await fs.writeFile(box.path('codex-cli'), '[mcp_servers.docs]\ncommand = "A"\n\n# Work profile: keep this\n[profiles.work]\nmodel = "o3"\n');
  await applyServers(box.context, copilotAndCodex, [on('docs')]);
  await fs.writeFile(box.path('copilot-cli'), JSON.stringify({ mcpServers: { docs: { type: 'local', command: 'B' } } }));
  await applyServers(box.context, copilotAndCodex, []);
  const text = await fs.readFile(box.path('codex-cli'), 'utf8');
  assert.match(text, /command = "B"/);
  assert.match(text, /# Work profile/, `the comment belonging to the next table is kept:\n${text}`);
  readTomlTables(text);
}));
