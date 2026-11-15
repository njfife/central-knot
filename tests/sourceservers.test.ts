// MCP servers from a link, on real settings files in a temp home and made-up Git repositories standing in for links
// (tests/sourcerepo.ts: nothing reaches the network): what at a link is a server (atlink.ts serversAt) and what is left out,
// a .mcp.json that breaks, no false change in any tool once a server is On, Claude Code's write and removal waiting for Write
// to Claude Code, each tool's own fields from a source (library.ts A SOURCE) with both of their costs, one name in two
// places, and Merge (merge.ts mergeServer). The source's table row by row is tests/library.test.ts's; skills from a link are
// tests/sources.test.ts's, agents tests/sourceagents.test.ts's.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readHistory } from '../src/history.ts';
import { fromSourceWords, statusLine } from '../src/libraryrow.ts';
import { readTool, serverHash, type NeutralServer } from '../src/mcp.ts';
import { mergeServer } from '../src/merge.ts';
import { applyServers, restoreServer, serversView, writeToClaude } from '../src/servers.ts';
import { openLibrary, saveLibrary, storeVersion } from '../src/serverstore.ts';
import type { ShareContext } from '../src/share.ts';
import { addSource, checkSource, previewSource, removeSource, rowClick, sourcesView } from '../src/sources.ts';
import type { HarnessId, SourcePreview, SourceResult } from '../src/types.ts';
import { repository, skillMd, standInHosts } from './sourcerepo.ts';

const hosts = await standInHosts();
test.after(() => hosts.cleanup());

const all: HarnessId[] = ['claude-cli', 'copilot-cli', 'codex-cli', 'pi-cli', 'opencode-cli'];
const FILES: Record<HarnessId, string> = {
  'claude-cli': '.claude.json', 'copilot-cli': '.copilot/mcp-config.json', 'codex-cli': '.codex/config.toml', 'pi-cli': '.pi/agent/mcp.json', 'opencode-cli': '.config/opencode/opencode.json',
};

/** A home with all five tools (their skills and agents folders too); `tools`: those Central Knot manages here. */
async function sandbox(tools: HarnessId[] = all) {
  const base = await realpath(await mkdtemp(join(tmpdir(), 'ck-source-servers-')));
  const home = join(base, 'home');
  for (const folder of ['.claude/skills', '.claude/agents', '.copilot/skills', '.copilot/agents', '.codex/skills', '.codex/agents', '.pi/agent/skills', '.config/opencode']) await mkdir(join(home, folder), { recursive: true });
  const context: ShareContext = { home, mode: 'custom', read: async () => [], build: 'test', settingsPath: join(base, 'settings.json'), realHome: join(base, 'real'), settleMs: 0 };
  return { home, context, tools, path: (tool: HarnessId) => join(home, FILES[tool]), cleanup: () => rm(base, { recursive: true, force: true }) };
}
type Box = Awaited<ReturnType<typeof sandbox>>;

/** A .mcp.json holding these servers, as Claude Code writes one. */
const mcpJson = (servers: Record<string, unknown>) => `${JSON.stringify({ mcpServers: servers }, null, 2)}\n`;
/** Looks at a link, then adds it, as the page's Look then Add do. */
async function add(box: Box, link: string) {
  const look = await previewSource(box.context, box.tools, link) as Extract<SourcePreview, { token: string }>;
  assert.ok('token' in look && !look.refused, `the look is refused: ${look.refused}`);
  const added = await addSource(box.context, box.tools, look.token);
  return { look, added, id: (await sourcesView(box.context, box.tools)).sources.find(source => source.link === link)!.id };
}
const check = (box: Box, id: string) => checkSource(box.context, async () => box.tools, id, work => work());
const look = async (box: Box, link: string) => await previewSource(box.context, box.tools, link) as Extract<SourcePreview, { token: string }>;
/** What a source's click did, by kind and name. */
const answered = (result: SourceResult) => (result.sourced ?? []).map(({ kind, name, answer }) => `${kind} ${name}: ${answer}`);
/** A source's lines, as kind, name, state and why. */
const linesOf = (found: { names: { kind: string; name?: string; key: string; state: string; why?: string }[] }) =>
  found.names.map(name => `${name.kind} ${name.name ?? name.key}: ${name.state}${name.why ? ` (${name.why})` : ''}`);
/** A server as the MCP servers page reads it: its row's facts and its item. */
async function server(box: Box, key: string) {
  const view = await serversView(box.context, box.tools);
  return { fact: view.items.find(entry => entry.key === key), item: view.library[key] };
}
/** One tool's entry for a server as read (none when it has none). */
const entryIn = async (box: Box, tool: HarnessId, name: string) => (await readTool(box.context, tool)).entries.find(entry => entry.name === name);
/** Claude Code's entry for a server as its file holds it (none when it has none). */
const claudeEntry = async (box: Box, name: string) => JSON.parse(await readFile(box.path('claude-cli'), 'utf8').catch(() => '{}')).mcpServers?.[name];
/** What a source's click did to one item, by name. */
const sourcedOf = (result: SourceResult, name: string) => result.sourced?.find(entry => entry.name === name);
const turn = (box: Box, key: string, on: boolean) => applyServers(box.context, box.tools, [{ key, on, except: [], seenOn: !on }]);
const write = (box: Box, ...keys: string[]) => writeToClaude(box.context, box.tools, keys);

// ---------- What at a link is a server ----------

test('What at a link is an MCP server: each entry of the .mcp.json in its folder, read as Claude Code reads it; one that can’t run once copied is left out, one that isn’t a server can’t be read; no other file is read', async () => {
  const repo = await repository(hosts, 'https://github.com/team/project');
  await repo.commit({
    // A byte-order mark is no reason not to read it.
    '.mcp.json': `﻿${mcpJson({
      docs: { command: 'npx', args: ['-y', 'docs'], env: { TOKEN: 'abc' }, timeout: 30 },
      search: { type: 'http', url: 'https://search.example.com/mcp', headers: { Authorization: 'Bearer abc' } },
      local: { command: 'node', args: ['./server.js'] },
      built: { command: 'node', args: ['dist/index.js'] },
      inside: { command: 'serve', cwd: 'tools' },
      plugin: { command: '${CLAUDE_PLUGIN_ROOT}/bin/run' },
      app: { command: '/Applications/Some.app/Contents/MacOS/server' },
      mixed: { command: 'serve', url: 'https://mixed.example.com/mcp' },
      Twin: { command: 'one' }, twin: { command: 'two' },
      nocommand: { type: 'stdio' }, nourl: { type: 'http' }, odd: 7,
    })}`,
    'dist/index.js': 'console.log("hi");\n',
    '.vscode/mcp.json': JSON.stringify({ servers: { vscode: { command: 'v' } } }), '.cursor/mcp.json': mcpJson({ cursor: { command: 'c' } }),
    '.claude/settings.json': mcpJson({ settings: { command: 's' } }), 'mcp.json': mcpJson({ nodot: { command: 'n' } }),
    'sub/.mcp.json': mcpJson({ deeper: { command: 'd' } }), 'mcp/central.json': JSON.stringify({ command: 'k' }),
  });
  const box = await sandbox();
  try {
    const found = await look(box, 'https://github.com/team/project');
    const repoFiles = 'it runs files from the repository, which aren’t copied';
    assert.deepEqual(linesOf(found), [
      'mcp docs: make', 'mcp search: make',
      `mcp local: leftOut (${repoFiles})`, `mcp built: leftOut (${repoFiles})`, `mcp inside: leftOut (${repoFiles})`,
      'mcp plugin: leftOut (it names a plugin’s own folder or settings, which only Claude Code fills in, for a plugin)',
      'mcp app: leftOut (it runs from inside an app, so it belongs to that app)',
      'mcp mixed: leftOut (it has both a command and a URL, which not every tool can hold)',
      // One line per key: the two names that differ only by case.
      'mcp Twin: leftOut (another server in its .mcp.json has this name but for case)',
      'mcp nocommand: unreadable (it has no command to run)', 'mcp nourl: unreadable (it has no URL)', 'mcp odd: unreadable (its entry in .mcp.json is not an object)',
    ]);
    assert.deepEqual(found.names.slice(0, 2).map(name => [name.there?.folder, name.there?.folderName, name.there?.files]), [['', 'project', ['.mcp.json']], ['', 'project', ['.mcp.json']]]);
    // An entry that can't be read holds back the servers' drops: the read isn't whole for them.
    const { added, id } = await add(box, 'https://github.com/team/project');
    assert.deepEqual(added.notWhole, ['mcp']);

    // The same server written as the bare map, once that source is removed: the same version, so it is linked.
    await removeSource(box.context, box.tools, id);
    const bare = await repository(hosts, 'https://github.com/team/bare');
    await bare.commit({ '.mcp.json': JSON.stringify({ docs: { command: 'npx', args: ['-y', 'docs'], env: { TOKEN: 'abc' } } }) });
    assert.deepEqual(linesOf(await look(box, 'https://github.com/team/bare')), ['mcp docs: link'], 'the bare map reads as mcpServers does');
  } finally { await box.cleanup(); }
});

test('Whose .mcp.json it is: a link whose folder is one skill keeps it as the skill’s file, broken SKILL.md or not; a loose agent beside one hides nothing; a plugin is a plugin', async () => {
  const box = await sandbox();
  try {
    const skill = await repository(hosts, 'https://github.com/team/skill-with-servers');
    await skill.commit({ 'SKILL.md': skillMd('review'), '.mcp.json': mcpJson({ docs: { command: 'npx' } }) });
    const one = await look(box, 'https://github.com/team/skill-with-servers');
    assert.deepEqual([linesOf(one), one.names[0].there?.files], [['skill review: make'], ['.mcp.json', 'SKILL.md']]);
    // Its SKILL.md breaks: still the skill's folder, so its servers are not read now and dropped once it is fixed.
    await skill.commit({ 'SKILL.md': '---\nname: [review\n---\nBroken.\n' });
    const broken = await look(box, 'https://github.com/team/skill-with-servers');
    assert.deepEqual([broken.names.map(name => `${name.kind} ${name.state}`), broken.names[0].there?.files], [['skill unreadable'], ['.mcp.json', 'SKILL.md']]);

    const loose = await repository(hosts, 'https://github.com/team/loose');
    await loose.commit({ 'writer.md': '---\nname: writer\ndescription: Writes.\n---\n\nWrite.\n', '.mcp.json': mcpJson({ docs: { command: 'npx' } }) });
    assert.deepEqual(linesOf(await look(box, 'https://github.com/team/loose')), ['agent writer: make', 'mcp docs: make']);

    const plugin = await repository(hosts, 'https://github.com/team/plugin');
    await plugin.commit({ '.claude-plugin/plugin.json': '{"name":"p"}', '.mcp.json': mcpJson({ docs: { command: 'npx' } }) });
    const held = await previewSource(box.context, box.tools, 'https://github.com/team/plugin');
    assert.deepEqual(['holds' in held && held.holds, 'names' in held && held.names], ['plugin', []]);
  } finally { await box.cleanup(); }
});

// ---------- A .mcp.json that breaks ----------

test('A .mcp.json that stops parsing, whose mcpServers turns null, or that becomes a link is one line that can’t be read, and no server turns Off; emptied with a skill still there, every server drops, Off and revertible', async () => {
  const repo = await repository(hosts, 'https://github.com/team/kit');
  const servers = { docs: { command: 'npx', args: ['docs'] }, search: { type: 'http', url: 'https://search.example.com/mcp' } };
  await repo.commit({ 'notes/SKILL.md': skillMd('notes'), '.mcp.json': mcpJson(servers) });
  const box = await sandbox(['copilot-cli', 'codex-cli']);
  try {
    const { id } = await add(box, 'https://github.com/team/kit');
    await turn(box, 'docs', true); await turn(box, 'search', true);
    const notOff = async (why: string) => {
      const done = await check(box, id);
      assert.deepEqual([answered(done), done.notWhole], [[], ['mcp']], why);
      // One line for the file, keyed by its name, with no name of its own; each linked server is as it was.
      assert.deepEqual(linesOf((await sourcesView(box.context, box.tools)).sources[0]), ['skill notes: nothing', `mcp .mcp.json: unreadable (its .mcp.json ${why})`, 'mcp docs: nothing', 'mcp search: nothing']);
      assert.deepEqual([(await server(box, 'docs')).item?.on, (await server(box, 'search')).item?.on, !!(await entryIn(box, 'copilot-cli', 'docs'))], [true, true, true]);
    };
    await repo.commit({ '.mcp.json': '{"mcpServers": {"docs": ' });
    await notOff('can’t be read as JSON (Unexpected end of JSON input)');
    await repo.commit({ '.mcp.json': '{"mcpServers": null}' });
    await notOff('has an mcpServers that is not an object');
    await repo.commit({ '.mcp.json': null, 'servers.json': mcpJson(servers) });
    await symlink('servers.json', join(repo.dir, '.mcp.json'));
    await repo.commit({});
    await notOff('is not a plain file');

    await rm(join(repo.dir, '.mcp.json'));
    await repo.commit({ '.mcp.json': mcpJson({}) });
    const dropped = await check(box, id);
    assert.deepEqual([answered(dropped).sort(), dropped.notWhole], [['mcp docs: drop', 'mcp search: drop'], undefined]);
    assert.deepEqual([(await server(box, 'docs')).item?.on, await entryIn(box, 'copilot-cli', 'docs'), (await server(box, 'docs')).fact?.fromSource?.removed], [false, undefined, true]);
    await turn(box, 'docs', true);
    assert.deepEqual([(await server(box, 'docs')).item?.on, !!(await entryIn(box, 'copilot-cli', 'docs')), (await server(box, 'docs')).fact?.fromSource], [true, true, undefined], 'turning it On is the revert');
  } finally { await box.cleanup(); }
});

test('Left out is not unreadable: a server that runs files from the repository, two skills of one name and two agents in one form hold back no drop; a server with no command holds back the servers’', async () => {
  const repo = await repository(hosts, 'https://github.com/team/mixed');
  await repo.commit({
    '.mcp.json': mcpJson({ docs: { command: 'npx' }, search: { command: 'search' }, local: { command: './run.sh' } }),
    'one/SKILL.md': skillMd('twin'), 'two/SKILL.md': skillMd('twin'), 'notes/SKILL.md': skillMd('notes'), 'keep/SKILL.md': skillMd('keep'),
    'agents/x.md': '---\nname: x\ndescription: X.\n---\nX.\n', 'x.md': '---\nname: x\ndescription: X.\n---\nOther.\n', 'agents/y.md': '---\nname: y\ndescription: Y.\n---\nY.\n',
  });
  const box = await sandbox(['copilot-cli', 'codex-cli']);
  try {
    const { id, added } = await add(box, 'https://github.com/team/mixed');
    assert.equal(added.notWhole, undefined, 'what is left out was read');
    await repo.commit({ '.mcp.json': mcpJson({ docs: { command: 'npx' }, local: { command: './run.sh' } }), 'notes/SKILL.md': null, 'agents/y.md': null });
    assert.deepEqual(answered(await check(box, id)).sort(), ['agent y: drop', 'mcp search: drop', 'skill notes: drop']);
    await repo.commit({ '.mcp.json': mcpJson({ local: { command: './run.sh' }, broken: { type: 'stdio' } }) });
    const held = await check(box, id);
    assert.deepEqual([answered(held), held.notWhole], [[], ['mcp']], 'one that can’t be read holds docs back');
  } finally { await box.cleanup(); }
});

// ---------- No false change once it is On ----------

test('No false change after On: an empty argument list, numbers, streamable-http, Copilot’s local, a name Codex must quote and an SSE server read back at their versions in every tool; the next update arrives everywhere, Claude Code at Write', async () => {
  const repo = await repository(hosts, 'https://github.com/team/forms');
  const forms = (args: unknown[]) => mcpJson({
    plain: { command: 'npx', args },
    numbers: { command: 'serve', args: ['--port', 8080], env: { RETRIES: 3, 'MY.VAR': 'x' } },
    stream: { type: 'streamable-http', url: 'https://stream.example.com/mcp' },
    local: { type: 'local', command: 'local-server' },
    events: { type: 'sse', url: 'https://events.example.com/sse' },
  });
  await repo.commit({ '.mcp.json': forms([]) });
  const box = await sandbox();
  try {
    const { id } = await add(box, 'https://github.com/team/forms');
    const keys = ['plain', 'numbers', 'stream', 'local', 'events'];
    await applyServers(box.context, box.tools, keys.map(key => ({ key, on: true, except: [], seenOn: false })));
    await write(box, ...keys);
    const before = await Promise.all(all.map(tool => readFile(box.path(tool), 'utf8')));
    const again = await applyServers(box.context, box.tools, []);
    assert.deepEqual([again.writes, again.notices ?? []], [0, []], 'a second pass writes nothing and takes nothing in');
    assert.deepEqual(await Promise.all(all.map(tool => readFile(box.path(tool), 'utf8'))), before);
    assert.deepEqual(answered(await check(box, id)), [], 'and the source sees nothing changed here');
    assert.deepEqual([(await entryIn(box, 'opencode-cli', 'plain'))?.hash, (await server(box, 'plain')).item?.hash], [serverHash({ transport: 'stdio', command: 'npx' }), serverHash({ transport: 'stdio', command: 'npx' })], 'the empty list is none, in OpenCode as at the source');
    assert.deepEqual(Object.keys((await server(box, 'events')).fact?.cannot ?? {}), ['codex-cli', 'pi-cli', 'opencode-cli'], 'an SSE server is held where there is no SSE, and its row says so');

    await repo.commit({ '.mcp.json': forms(['-y']) });
    const updated = await check(box, id);
    assert.deepEqual(updated.sourced?.map(({ name, answer, written, deferred }) => [name, answer, written, deferred]), [['plain', 'update', ['copilot-cli', 'codex-cli', 'pi-cli', 'opencode-cli'], ['claude-cli']]]);
    await write(box, 'plain');
    for (const tool of all) assert.deepEqual((await entryIn(box, tool, 'plain'))?.server.args, ['-y'], `${tool} has the update`);
    assert.equal((await applyServers(box.context, box.tools, [])).writes, 0);
  } finally { await box.cleanup(); }
});

test('A server taken in before this version with "args": [] is taken in once more as edited in a tool, once, and no file changes', async () => {
  const box = await sandbox(['claude-cli', 'copilot-cli']);
  try {
    await writeFile(box.path('claude-cli'), mcpJson({ docs: { type: 'stdio', command: 'npx', args: [] } }));
    await writeFile(box.path('copilot-cli'), mcpJson({ docs: { type: 'local', command: 'npx', args: [], tools: ['*'] } }));
    await turn(box, 'docs', true);
    // The record as a version before this one left it: the version holds the empty list, and so does what was applied.
    const old: NeutralServer = { transport: 'stdio', command: 'npx', args: [] }, oldHash = serverHash(old);
    const { library } = await openLibrary(box.context, true), item = library.items.docs;
    await storeVersion(box.context, 'docs', old);
    Object.assign(item, { hash: oldHash, versions: [{ ...item.versions[0], hash: oldHash }], applied: { 'claude-cli': oldHash, 'copilot-cli': oldHash } });
    await saveLibrary(box.context.home, library);
    const files = await Promise.all(['claude-cli', 'copilot-cli'].map(tool => readFile(box.path(tool as HarnessId), 'utf8')));
    const edits = async () => (await readHistory(box.context)).filter(event => event.key === 'mcp:docs' && event.kind === 'edit').length;
    await applyServers(box.context, box.tools, []);
    assert.equal(await edits(), 1);
    await applyServers(box.context, box.tools, []);
    assert.equal(await edits(), 1, 'once');
    assert.deepEqual(await Promise.all(['claude-cli', 'copilot-cli'].map(tool => readFile(box.path(tool as HarnessId), 'utf8'))), files);
  } finally { await box.cleanup(); }
});

// ---------- Claude Code's write waits ----------

test('An On server updated at its source: every other tool gets it at once, Claude Code waits and its row says so; a second update follows too, and Write writes the newest', async () => {
  const repo = await repository(hosts, 'https://github.com/team/wait');
  await repo.commit({ '.mcp.json': mcpJson({ docs: { command: 'npx', args: ['one'] } }) });
  const box = await sandbox(['claude-cli', 'copilot-cli', 'codex-cli']);
  try {
    const { id } = await add(box, 'https://github.com/team/wait');
    await turn(box, 'docs', true);
    assert.deepEqual([(await server(box, 'docs')).fact?.waits, await claudeEntry(box, 'docs')], [['claude-cli'], undefined]);
    await write(box, 'docs');
    await repo.commit({ '.mcp.json': mcpJson({ docs: { command: 'npx', args: ['two'] } }) });
    const first = await check(box, id);
    assert.deepEqual(first.sourced?.map(({ answer, on, written, deferred }) => [answer, on, written, deferred]), [['update', true, ['copilot-cli', 'codex-cli'], ['claude-cli']]]);
    assert.deepEqual([(await entryIn(box, 'copilot-cli', 'docs'))?.server.args, (await claudeEntry(box, 'docs')).args, (await server(box, 'docs')).fact?.waits], [['two'], ['one'], ['claude-cli']]);
    await repo.commit({ '.mcp.json': mcpJson({ docs: { command: 'npx', args: ['three'] } }) });
    assert.deepEqual(answered(await check(box, id)), ['mcp docs: update'], 'a waiting write is not a change here');
    await write(box, 'docs');
    assert.deepEqual([(await claudeEntry(box, 'docs')).args, (await server(box, 'docs')).fact?.waits], [['three'], undefined]);

    // Claude Code alone: the update is On and waits there, never "kept Off".
    box.tools.splice(0, box.tools.length, 'claude-cli');
    await repo.commit({ '.mcp.json': mcpJson({ docs: { command: 'npx', args: ['four'] } }) });
    assert.deepEqual((await check(box, id)).sourced?.map(({ on, written, deferred }) => [on, written, deferred]), [[true, [], ['claude-cli']]]);
  } finally { await box.cleanup(); }
});

test('A hand edit in Claude Code’s entry while its write waits loses to the current version and is kept as one; it is then no change here, so the source’s next change follows, and Write writes the newest', async () => {
  const repo = await repository(hosts, 'https://github.com/team/edge');
  await repo.commit({ '.mcp.json': mcpJson({ docs: { command: 'npx', args: ['one'] } }) });
  const box = await sandbox(['claude-cli', 'copilot-cli']);
  try {
    const { id } = await add(box, 'https://github.com/team/edge');
    await turn(box, 'docs', true); await write(box, 'docs');
    await repo.commit({ '.mcp.json': mcpJson({ docs: { command: 'npx', args: ['two'] } }) });
    await check(box, id);
    await writeFile(box.path('claude-cli'), mcpJson({ docs: { type: 'stdio', command: 'npx', args: ['mine'] } }));
    await applyServers(box.context, box.tools, []);
    const { item } = await server(box, 'docs');
    // An MCP entry has no time of its own, so an edit made where the current version had moved on loses to it (library.ts THE RULE).
    assert.deepEqual([item?.versions.map(version => version.from.how), (await entryIn(box, 'copilot-cli', 'docs'))?.server.args], [['edited', 'source', 'source'], ['two']]);
    assert.ok((await readHistory(box.context)).some(event => event.key === 'mcp:docs' && event.kind === 'kept-edit'), 'History says the edit was kept');
    await repo.commit({ '.mcp.json': mcpJson({ docs: { command: 'npx', args: ['three'] } }) });
    assert.deepEqual(answered(await check(box, id)), ['mcp docs: update']);
    await write(box, 'docs');
    assert.deepEqual([(await claudeEntry(box, 'docs')).args, (await entryIn(box, 'copilot-cli', 'docs'))?.server.args], [['three'], ['three']]);
  } finally { await box.cleanup(); }
});

test('The source drops an On server: it leaves every other tool; its row says removed at its source and still in Claude Code until Write; Write removes it, and Turn on then Write gives Claude Code back the same entry', async () => {
  const repo = await repository(hosts, 'https://github.com/team/drop');
  await repo.commit({ 'notes/SKILL.md': skillMd('notes'), '.mcp.json': mcpJson({ docs: { command: 'npx', args: ['docs'], timeout: 30 } }) });
  const box = await sandbox(['claude-cli', 'copilot-cli', 'codex-cli']);
  try {
    const { id } = await add(box, 'https://github.com/team/drop');
    await turn(box, 'docs', true); await write(box, 'docs');
    const was = await claudeEntry(box, 'docs');
    assert.deepEqual(was, { type: 'stdio', command: 'npx', args: ['docs'], timeout: 30 });
    await repo.commit({ '.mcp.json': mcpJson({}) });
    const done = await check(box, id);
    assert.deepEqual(done.sourced?.map(({ answer, on, removed, deferred }) => [answer, on, removed, deferred]), [['drop', undefined, ['copilot-cli', 'codex-cli'], ['claude-cli']]]);
    const { fact, item } = await server(box, 'docs');
    assert.deepEqual([fact?.fromSource, fact?.waits, await claudeEntry(box, 'docs')], [{ link: 'https://github.com/team/drop', removed: true }, ['claude-cli'], was]);
    assert.deepEqual([fromSourceWords(fact!.fromSource!).tag?.text, statusLine(fact!, item, box.tools)], ['removed at its source', 'Off · still in Claude Code until you click Write to Claude Code. Turn it on to put it in every tool.']);
    // Its line on Sources reads the same facts (sourcespage.ts removedRow).
    assert.deepEqual(linesOf((await sourcesView(box.context, box.tools)).sources[0]), ['skill notes: nothing']);
    await write(box, 'docs');
    assert.equal(await claudeEntry(box, 'docs'), undefined);
    await turn(box, 'docs', true); await write(box, 'docs');
    assert.deepEqual(await claudeEntry(box, 'docs'), was, 'its own fields come back with it');
  } finally { await box.cleanup(); }
});

test('Turn on before Write cancels the waiting removal: nothing is written to Claude Code', async () => {
  const repo = await repository(hosts, 'https://github.com/team/cancel');
  await repo.commit({ 'notes/SKILL.md': skillMd('notes'), '.mcp.json': mcpJson({ docs: { command: 'npx' } }) });
  const box = await sandbox(['claude-cli', 'copilot-cli']);
  try {
    const { id } = await add(box, 'https://github.com/team/cancel');
    await turn(box, 'docs', true); await write(box, 'docs');
    const text = await readFile(box.path('claude-cli'), 'utf8');
    await repo.commit({ '.mcp.json': mcpJson({}) });
    await check(box, id);
    await turn(box, 'docs', true);
    assert.deepEqual([(await server(box, 'docs')).fact?.waits, (await write(box, 'docs')).results, await readFile(box.path('claude-cli'), 'utf8')], [undefined, [], text]);
  } finally { await box.cleanup(); }
});

// ---------- Each tool's own fields ----------

test('His own fields stay: his server in Claude Code with his timeout is linked to the same one at a source and follows its shared part; an Off server keeps them too; a new one’s first Write writes the source’s fields', async () => {
  const box = await sandbox(['claude-cli', 'copilot-cli']);
  try {
    await writeFile(box.path('claude-cli'), mcpJson({ docs: { type: 'stdio', command: 'npx', args: ['docs'], timeout: 30 } }));
    await turn(box, 'docs', true);
    const repo = await repository(hosts, 'https://github.com/team/own');
    await repo.commit({ '.mcp.json': mcpJson({ docs: { command: 'npx', args: ['docs'], timeout: 99 }, fresh: { command: 'fresh', env: { A: '1' }, timeout: 99 } }) });
    const { id, added } = await add(box, 'https://github.com/team/own');
    assert.deepEqual(answered(added), ['mcp docs: link', 'mcp fresh: make']);
    await repo.commit({ '.mcp.json': mcpJson({ docs: { command: 'npx', args: ['docs', '--fast'], timeout: 99 }, fresh: { command: 'fresh', env: { A: '1' }, timeout: 99 } }) });
    await check(box, id); await write(box, 'docs');
    assert.deepEqual(await claudeEntry(box, 'docs'), { type: 'stdio', command: 'npx', args: ['docs', '--fast'], timeout: 30 });
    await turn(box, 'docs', false); await write(box, 'docs');
    await turn(box, 'docs', true); await write(box, 'docs');
    assert.equal((await claudeEntry(box, 'docs')).timeout, 30, 'Off then On keeps them');

    await turn(box, 'fresh', true); await write(box, 'fresh');
    assert.deepEqual(await claudeEntry(box, 'fresh'), { type: 'stdio', command: 'fresh', env: { A: '1' }, timeout: 99 });
  } finally { await box.cleanup(); }
});

test('The two costs of own fields from a source: a timeout changed alone there arrives nowhere and the check says nothing came in; changed with the shared part, the shared part alone arrives', async () => {
  const repo = await repository(hosts, 'https://github.com/team/costs');
  const at = (args: string[], timeout: number) => mcpJson({ fresh: { command: 'fresh', args, timeout } });
  await repo.commit({ '.mcp.json': at(['a'], 99) });
  const box = await sandbox(['claude-cli', 'copilot-cli']);
  try {
    const { id } = await add(box, 'https://github.com/team/costs');
    await turn(box, 'fresh', true); await write(box, 'fresh');
    await repo.commit({ '.mcp.json': at(['a'], 5) });
    assert.deepEqual([answered(await check(box, id)), (await claudeEntry(box, 'fresh')).timeout], [[], 99]);
    await repo.commit({ '.mcp.json': at(['b'], 7) });
    assert.deepEqual(answered(await check(box, id)), ['mcp fresh: update']);
    await write(box, 'fresh');
    assert.deepEqual([(await claudeEntry(box, 'fresh')).args, (await claudeEntry(box, 'fresh')).timeout], [['b'], 99]);
  } finally { await box.cleanup(); }
});

// ---------- One name ----------

test('One name: a different server here is not brought in; one found only in a tool comes in Off from the source and that tool’s entry is left alone until On keeps it as a version', async () => {
  const repo = await repository(hosts, 'https://github.com/team/names');
  await repo.commit({ '.mcp.json': mcpJson({ docs: { command: 'npx', args: ['source'] } }) });
  const box = await sandbox(['copilot-cli', 'codex-cli']);
  try {
    await writeFile(box.path('copilot-cli'), mcpJson({ docs: { type: 'local', command: 'npx', args: ['mine'], tools: ['*'] } }));
    const mine = await readFile(box.path('copilot-cli'), 'utf8');
    assert.deepEqual(linesOf(await look(box, 'https://github.com/team/names')), ['mcp docs: make']);
    await add(box, 'https://github.com/team/names');
    assert.deepEqual([(await server(box, 'docs')).item?.on, await readFile(box.path('copilot-cli'), 'utf8')], [false, mine], 'his entry is that tool’s own while the item is Off');
    await turn(box, 'docs', true);
    const { item } = await server(box, 'docs');
    assert.deepEqual([item?.versions.map(version => version.from.how).sort(), (await entryIn(box, 'copilot-cli', 'docs'))?.server.args], [['source', 'was-in'], ['source']]);

    const other = await sandbox(['copilot-cli']);
    try {
      await writeFile(other.path('copilot-cli'), mcpJson({ docs: { type: 'local', command: 'npx', args: ['mine'] } }));
      await applyServers(other.context, other.tools, [{ key: 'docs', on: true, except: [] }]);
      assert.deepEqual(linesOf(await look(other, 'https://github.com/team/names')), ['mcp docs: differs']);
    } finally { await other.cleanup(); }
  } finally { await box.cleanup(); }
});

test('A server, a skill and an agent named reviewer at one source all come in, and a click on one line acts on that kind alone', async () => {
  const repo = await repository(hosts, 'https://github.com/team/three');
  await repo.commit({ 'reviewer/SKILL.md': skillMd('reviewer'), 'agents/reviewer.md': '---\nname: reviewer\ndescription: Reviews.\n---\n\nReview.\n', '.mcp.json': mcpJson({ reviewer: { command: 'review' } }) });
  const box = await sandbox(['claude-cli', 'copilot-cli', 'codex-cli']);
  try {
    const { id, added } = await add(box, 'https://github.com/team/three');
    assert.deepEqual(answered(added), ['skill reviewer: make', 'agent reviewer: make', 'mcp reviewer: make']);
    await applyServers(box.context, box.tools, [{ key: 'reviewer', on: false, except: [], deleted: true }]);
    const back = await rowClick(box.context, box.tools, id, 'mcp', 'reviewer', 'bringBack');
    assert.deepEqual(answered(back), ['mcp reviewer: make']);
    await turn(box, 'reviewer', true);
    const view = await sourcesView(box.context, box.tools);
    assert.deepEqual(view.sources[0].names.map(name => `${name.kind} ${name.on}`), ['skill false', 'agent false', 'mcp true']);
  } finally { await box.cleanup(); }
});

// ---------- Merge ----------

test('Merge: an environment variable changed here and another at the source merge, in every tool and in Claude Code at Write; Undo puts yours back and the update waits again; the same variable both ways, or a header added both ways, is a conflict named in words', async () => {
  const repo = await repository(hosts, 'https://github.com/team/merge');
  const at = (env: Record<string, string>) => mcpJson({ docs: { command: 'npx', env }, web: { type: 'http', url: 'https://web.example.com/mcp' } });
  await repo.commit({ '.mcp.json': at({ A: '1', B: '1' }) });
  const box = await sandbox(['claude-cli', 'copilot-cli', 'codex-cli']);
  try {
    const { id } = await add(box, 'https://github.com/team/merge');
    await turn(box, 'docs', true); await turn(box, 'web', true); await write(box, 'docs', 'web');
    const copilot = JSON.parse(await readFile(box.path('copilot-cli'), 'utf8'));
    copilot.mcpServers.docs.env.A = '2';
    await writeFile(box.path('copilot-cli'), JSON.stringify(copilot, null, 2));
    await applyServers(box.context, box.tools, []);
    await repo.commit({ '.mcp.json': at({ A: '1', B: '3' }) });
    assert.deepEqual(answered(await check(box, id)), ['mcp docs: wait']);
    const merged = sourcedOf(await rowClick(box.context, box.tools, id, 'mcp', 'docs', 'merge'), 'docs');
    assert.deepEqual([merged?.merge, merged?.written, merged?.deferred], ['merged', ['copilot-cli', 'codex-cli'], ['claude-cli']]);
    assert.deepEqual((await entryIn(box, 'codex-cli', 'docs'))?.server.env, { A: '2', B: '3' });
    await write(box, 'docs');
    assert.deepEqual((await claudeEntry(box, 'docs')).env, { A: '2', B: '3' });

    const entry = (await readHistory(box.context)).find(event => event.key === 'mcp:docs' && event.cause === 'source-merged')!;
    await restoreServer(box.context, box.tools, entry.id);
    assert.deepEqual([(await entryIn(box, 'copilot-cli', 'docs'))?.server.env, (await sourcesView(box.context, box.tools)).sources[0].names.find(name => name.key === 'docs')?.state], [{ A: '2', B: '1' }, 'wait']);
    assert.deepEqual(answered(await rowClick(box.context, box.tools, id, 'mcp', 'docs', 'keep')), ['mcp docs: keep']);

    await repo.commit({ '.mcp.json': at({ A: '9', B: '3' }) });
    await check(box, id);
    const clash = sourcedOf(await rowClick(box.context, box.tools, id, 'mcp', 'docs', 'merge'), 'docs');
    assert.deepEqual([clash?.merge, (await entryIn(box, 'copilot-cli', 'docs'))?.server.env], [{ conflicts: ['the environment variable A'] }, { A: '2', B: '1' }]);

    const codex = await readFile(box.path('codex-cli'), 'utf8');
    await writeFile(box.path('codex-cli'), codex.replace('url = "https://web.example.com/mcp"', 'url = "https://web.example.com/mcp"\nhttp_headers = { X = "mine" }'));
    await applyServers(box.context, box.tools, []);
    await repo.commit({ '.mcp.json': mcpJson({ docs: { command: 'npx', env: { A: '9', B: '3' } }, web: { type: 'http', url: 'https://web.example.com/mcp', headers: { X: 'theirs' } } }) });
    await check(box, id);
    assert.deepEqual(sourcedOf(await rowClick(box.context, box.tools, id, 'mcp', 'web', 'merge'), 'web')?.merge, { conflicts: ['the header X'] });
  } finally { await box.cleanup(); }
});

test('Merge’s parts for a server: each field whole, each environment variable and header by its name, a "/" in a name kept apart from the field', async () => {
  const base = await realpath(await mkdtemp(join(tmpdir(), 'ck-merge-server-')));
  const context: ShareContext = { home: base, mode: 'custom', read: async () => [], build: 'test', settingsPath: join(base, 'settings.json'), realHome: join(base, 'real'), settleMs: 0 };
  try {
    const item = { key: 'docs' } as Parameters<typeof mergeServer>[1];
    const server = (args: string[], env: Record<string, string>): NeutralServer => ({ transport: 'stdio', command: 'npx', args, env });
    const done = await mergeServer(context, item, { base: server(['a'], { 'a/b': '1', a: '1' }), yours: server(['a'], { 'a/b': '2', a: '1' }), theirs: server(['b'], { 'a/b': '1', a: '3' }) });
    assert.deepEqual(done, { merged: server(['b'], { 'a/b': '2', a: '3' }) });
    const both = await mergeServer(context, item, { base: server(['a'], {}), yours: server(['b'], {}), theirs: server(['c'], {}) });
    assert.deepEqual(both, { conflicts: ['the arguments'] }, 'a value has no lines: the list both changed is a conflict');
  } finally { await rm(base, { recursive: true, force: true }); }
});
