// What a pass of the whole home says a person would see (homepass.ts pageSees), as worked examples on real files in a temp home
// with Claude Code, Copilot CLI and Codex, a plugin installed in Claude Code and one in Codex. main.ts tells an open page when
// a background pass's value differs from the one the page was last given (main.ts seenChanged).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, realpath, rm, utimes, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { setSyncEverything } from '../src/everything.ts';
import { homePass } from '../src/homepass.ts';
import { withPartSwitch } from '../src/partswitch.ts';
import type { ShareContext } from '../src/share.ts';
import type { HarnessId } from '../src/types.ts';

const tools: HarnessId[] = ['claude-cli', 'copilot-cli', 'codex-cli'];
const put = async (path: string, text: string) => { await mkdir(dirname(path), { recursive: true }); await writeFile(path, text); };
const skill = (name: string, body = 'Take notes.') => `---\nname: ${name}\ndescription: ${name} things.\n---\n\n${body}\n`;

/** A home with a record whose Synchronize everything is off, so what a tool has stays found. */
async function sandbox() {
  const base = await realpath(await mkdtemp(join(tmpdir(), 'ck-homepass-')));
  const home = join(base, 'home');
  for (const folder of ['.claude/skills', '.copilot/skills', '.codex/skills']) await mkdir(join(home, folder), { recursive: true });
  const context: ShareContext = { home, mode: 'custom', read: async () => [], build: 'test', settingsPath: join(base, 'settings.json'), realHome: join(base, 'real'), settleMs: 0 };
  assert.deepEqual(await setSyncEverything(context, false), {});
  // The pass's own reads, as main.ts gives each pass: what the value is made from is read once.
  const seen = async (writes = true) => (await homePass({ ...context, reads: new Map() }, tools, writes)).seen;
  return { home, context, seen, cleanup: () => rm(base, { recursive: true, force: true }) };
}

test('A found skill, agent or server edited by hand changes what the page sees; written again with the same bytes, or only touched, it does not; deleted, it does', async () => {
  const box = await sandbox();
  try {
    const notes = join(box.home, '.claude/skills/notes/SKILL.md'), agent = join(box.home, '.claude/agents/helper.md'), servers = join(box.home, '.claude.json');
    await put(notes, skill('notes'));
    await put(agent, '---\nname: helper\ndescription: Helps\n---\n\nYou help.\n');
    await put(servers, JSON.stringify({ numStartups: 1, mcpServers: { docs: { command: 'npx', args: ['-y', 'docs'] } } }));
    const first = await box.seen();
    assert.ok(first);
    await put(notes, skill('notes'));
    await utimes(notes, new Date(), new Date(Date.now() + 60_000));
    // Claude Code rewrites its .claude.json as it runs: its own fields change, the server's do not.
    await put(servers, JSON.stringify({ numStartups: 2, mcpServers: { docs: { command: 'npx', args: ['-y', 'docs'] } } }));
    assert.equal(await box.seen(), first, 'the same content, a newer time, a tool’s own field');
    const edits = [first];
    for (const [path, text] of [[notes, skill('notes', 'Take short notes.')], [agent, '---\nname: helper\ndescription: Helps\n---\n\nYou help a lot.\n'],
      [servers, JSON.stringify({ numStartups: 2, mcpServers: { docs: { command: 'npx', args: ['-y', 'docs@2'] } } })]] as const) {
      await put(path, text);
      edits.push((await box.seen())!);
    }
    await rm(dirname(notes), { recursive: true });
    edits.push((await box.seen())!);
    assert.equal(new Set(edits).size, 5, 'each edit, and the deletion, is a value of its own');
  } finally { await box.cleanup(); }
});

test('A plugin’s part changed in place, the plugin or one part turned off by the tool, and the plugin taken out of the record each change it; put back, it is the first value again; the record written in another order is not a change', async () => {
  const box = await sandbox();
  try {
    const copy = join(box.home, '.claude/plugins/cache/team/kit/1.0.0'), record = join(box.home, '.claude/plugins/installed_plugins.json');
    await put(join(copy, '.claude-plugin/plugin.json'), JSON.stringify({ name: 'kit', version: '1.0.0' }));
    await put(join(copy, 'skills/tidy/SKILL.md'), skill('tidy', 'Trim every cell.'));
    await put(join(copy, '.mcp.json'), JSON.stringify({ mcpServers: { sheets: { command: 'sheets-mcp' } } }));
    const other = join(box.home, '.claude/plugins/cache/team/more/1.0.0');
    await put(join(other, 'skills/spare/SKILL.md'), skill('spare'));
    const installs = { 'kit@team': [{ scope: 'user', installPath: copy, version: '1.0.0' }], 'more@team': [{ scope: 'user', installPath: other, version: '1.0.0' }] };
    await put(record, JSON.stringify({ version: 2, plugins: installs }));
    const first = await box.seen();
    await put(record, JSON.stringify({ version: 2, plugins: { 'more@team': installs['more@team'], 'kit@team': installs['kit@team'] } }));
    assert.equal(await box.seen(), first, 'the same installs, listed in another order');
    await put(join(copy, 'skills/tidy/SKILL.md'), skill('tidy', 'Remove duplicate rows.'));
    const edited = await box.seen();
    const settings = join(box.home, '.claude/settings.json');
    await put(settings, JSON.stringify({ enabledPlugins: { 'kit@team': false } }));
    const off = await box.seen();
    // Its MCP server turned off alone, as Claude Code's own switch for it is written (partswitch.ts).
    await put(settings, withPartSwitch('claude-cli', '{}', { plugin: 'kit', marketplace: 'team', kind: 'mcp', name: 'sheets' }, true));
    const partOff = await box.seen();
    await put(record, JSON.stringify({ version: 2, plugins: { 'more@team': installs['more@team'] } }));
    const removed = await box.seen();
    assert.equal(new Set([first, edited, off, partOff, removed]).size, 5, 'each is a value of its own');
    await put(settings, '{}');
    await put(join(copy, 'skills/tidy/SKILL.md'), skill('tidy', 'Trim every cell.'));
    await put(record, JSON.stringify({ version: 2, plugins: installs }));
    assert.equal(await box.seen(), first, 'put back as it was');
  } finally { await box.cleanup(); }
});

test('The same plugin cached at another path, or the same skills turned off in another order, is no change', async () => {
  const box = await sandbox();
  try {
    // Claude Code caches a plugin with no version in a folder named for its commit: cached again, the folder is another.
    const [first, again] = ['1a2b3c4', '5d6e7f8'].map(commit => join(box.home, '.claude/plugins/cache/team/kit', commit));
    for (const folder of [first, again]) await put(join(folder, 'skills/tidy/SKILL.md'), skill('tidy'));
    const cachedAt = (folder: string) =>
      put(join(box.home, '.claude/plugins/installed_plugins.json'), JSON.stringify({ version: 2, plugins: { 'kit@team': [{ scope: 'user', installPath: folder }] } }));
    // Copilot CLI turns two of a plugin's skills off by its own list, in whatever order it writes it.
    const copy = join(box.home, '.copilot/installed-plugins/m/demo');
    await put(join(copy, '.claude-plugin/plugin.json'), JSON.stringify({ name: 'demo', version: '1.0.0' }));
    for (const name of ['hello', 'bye']) await put(join(copy, `skills/${name}/SKILL.md`), skill(name));
    await put(join(box.home, '.copilot/config.json'), JSON.stringify({ installedPlugins: [{ name: 'demo', marketplace: 'm', version: '1.0.0', cache_path: copy }] }));
    const turnedOff = (names: string[]) => put(join(box.home, '.copilot/settings.json'), JSON.stringify({ disabledSkills: names.map(name => `demo:${name}`) }));
    await cachedAt(first);
    await turnedOff(['hello', 'bye']);
    const before = await box.seen();
    await cachedAt(again);
    assert.equal(await box.seen(), before, 'cached again at another path');
    await turnedOff(['bye', 'hello']);
    assert.equal(await box.seen(), before, 'the same skills turned off, listed in another order');
  } finally { await box.cleanup(); }
});

test('Codex’s plugin agents are not in it, as the page lists none; its plugin’s skill is', async () => {
  const box = await sandbox();
  try {
    const copy = join(box.home, '.codex/plugins/cache/m/demo/1.2.0');
    await put(join(copy, '.claude-plugin/plugin.json'), JSON.stringify({ name: 'demo', version: '1.2.0' }));
    await put(join(copy, 'skills/hello/SKILL.md'), skill('hello'));
    await put(join(copy, 'agents/checker.md'), '---\nname: checker\ndescription: Checks.\n---\n\nCheck.\n');
    await put(join(box.home, '.codex/config.toml'), '[plugins."demo@m"]\nenabled = true\n');
    const first = await box.seen();
    await put(join(copy, 'agents/checker.md'), '---\nname: checker\ndescription: Checks.\n---\n\nCheck twice.\n');
    assert.equal(await box.seen(), first);
    await put(join(copy, 'skills/hello/SKILL.md'), skill('hello', 'Say hello.'));
    assert.notEqual(await box.seen(), first);
  } finally { await box.cleanup(); }
});

test('A pass that does not see the whole home makes no value, never an empty home’s: Sync off, or a home with no record', async () => {
  const box = await sandbox();
  try {
    await put(join(box.home, '.claude/skills/notes/SKILL.md'), skill('notes'));
    assert.equal(await box.seen(false), undefined, 'Sync off: the pass reads no kind');
    await rm(join(box.home, '.central-knot'), { recursive: true });
    assert.equal(await box.seen(), undefined, 'no record: each kind’s pass stops before its look');
  } finally { await box.cleanup(); }
});

test('A plugin read that throws makes no value and says why, for the log', async () => {
  const box = await sandbox();
  try {
    // The pass's own read of Claude Code's installed copies failed (plugins.ts installedCopies, cached in the pass's reads).
    const failed = Promise.reject(new Error('the copies could not be listed'));
    failed.catch(() => undefined);
    const reads = new Map<string, Promise<unknown>>([['installed-copies:claude-cli', failed]]);
    const done = await homePass({ ...box.context, reads }, tools, true);
    assert.deepEqual([done.seen, (done.seenFailed as Error | undefined)?.message], [undefined, 'the copies could not be listed']);
  } finally { await box.cleanup(); }
});
