// Antigravity as a tool: what Central Knot finds of it and reads and writes for it. The forms here are the ones measured on its
// CLI 1.5.14 in throwaway homes (the pull request that added it says what was seen).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmod, lstat, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { discover } from '../src/discovery.ts';
import { readTool } from '../src/mcp.ts';
import { mcpDisabled, ownWithoutSwitch, withMcpSwitch } from '../src/mcpswitch.ts';
import { envOverride, harnesses } from '../src/harnesses.ts';
import { instructionsView } from '../src/instructions.ts';
import { readUsage } from '../src/usage.ts';
import { appCandidates, executableCandidates } from '../src/platform.ts';
import { managedTools, presentTools } from '../src/presence.ts';
import { reloadAdvice } from '../src/reload.ts';
import { applyServers, serversView } from '../src/servers.ts';
import type { ShareContext } from '../src/share.ts';
import { applySkills, clearSwitch, restoreSkill, skillsView } from '../src/skills.ts';
import { isDisabled, readSwitchFile } from '../src/skillswitch.ts';
import type { HarnessId } from '../src/types.ts';

const tools: HarnessId[] = ['claude-cli', 'antigravity-cli'];
const CONFIG = '.gemini/config';
const text = (name: string, body = 'Body.') => `---\nname: ${name}\ndescription: The ${name} skill.\n---\n\n${body}\n`;

/** A home with Claude Code's folder and Antigravity's, read as a chosen folder is (no probes). */
async function sandbox(present: HarnessId[] = tools) {
  const base = await realpath(await mkdtemp(join(tmpdir(), 'ck-antigravity-')));
  const home = join(base, 'home');
  for (const folder of ['.claude', CONFIG]) await mkdir(join(home, folder), { recursive: true });
  const context: ShareContext = { home, mode: 'custom', read: () => Promise.all(present.map(harness => discover({ home, mode: 'custom', harness }))), build: 'test', settingsPath: join(base, 'settings.json'), realHome: join(base, 'real'), settleMs: 0 };
  return { base, home, context, cleanup: () => rm(base, { recursive: true, force: true }) };
}
async function skill(home: string, root: string, folder: string, content = text(folder)) {
  await mkdir(join(home, root, folder), { recursive: true });
  await writeFile(join(home, root, folder, 'SKILL.md'), content);
}
/** A stand-in CLI in the home's ~/.local/bin that answers --version. */
async function cli(home: string, name: string) {
  await mkdir(join(home, '.local/bin'), { recursive: true });
  await writeFile(join(home, '.local/bin', name), '#!/bin/sh\necho 1.5.14\n');
  await chmod(join(home, '.local/bin', name), 0o755);
}
/** Antigravity in a home as the app reads it on this computer: its CLIs and apps looked for in the home alone. */
const found = (home: string) => discover({ home, mode: 'actual', harness: 'antigravity-cli', runProbes: true,
  binaries: executableCandidates(home, '', 'agy').filter(path => path.startsWith(home)), apps: appCandidates(home, 'agy').filter(app => app.app.startsWith(home)) });
const exists = (path: string) => lstat(path).then(() => true, () => false);
const config = (home: string, path = '') => join(home, CONFIG, path);

test('A home with agy and a skill in ~/.gemini/config/skills has Antigravity, and that skill’s row has an Antigravity copy', async () => {
  const box = await sandbox();
  try {
    await cli(box.home, 'agy');
    await skill(box.home, `${CONFIG}/skills`, 'alpha');
    // The other folders it reads are not Central Knot's: ~/.gemini/skills is the Gemini CLI's too.
    await skill(box.home, '.gemini/skills', 'gemini-only');
    const snapshot = await found(box.home);
    assert.deepEqual([snapshot.harnessName, snapshot.detection, snapshot.probe.version], ['Antigravity', 'Installed', '1.5.14']);
    assert.deepEqual(presentTools([snapshot]), ['antigravity-cli']);
    assert.deepEqual(snapshot.skills.map(found => `${found.folder}: ${found.rootLabel}`), ['alpha: Antigravity skills']);
    const row = (await skillsView(box.context, tools)).items.find(item => item.key === 'alpha')!;
    assert.deepEqual(Object.keys(row.copies), ['antigravity-cli']);
  } finally { await box.cleanup(); }
});

test('Antigravity is found by either CLI name or either Mac app, and a ~/.gemini folder alone is no Antigravity', async () => {
  const box = await sandbox();
  try {
    await mkdir(config(box.home, 'skills'), { recursive: true });
    const alone = await found(box.home);
    assert.deepEqual([alone.detection, presentTools([alone])], ['Config found but app not detected', []]);
    await cli(box.home, 'antigravity');
    assert.deepEqual([(await found(box.home)).detection, presentTools([await found(box.home)])], ['Installed', ['antigravity-cli']]);
    await rm(join(box.home, '.local'), { recursive: true });
    const ide = join(box.home, 'Applications/Antigravity IDE.app/Contents');
    await mkdir(ide, { recursive: true });
    await writeFile(join(ide, 'Info.plist'), '<plist><dict><key>CFBundleShortVersionString</key><string>2.8.0</string></dict></plist>\n');
    const app = await found(box.home);
    assert.deepEqual([app.detection, app.app?.name, app.app?.version], ['App only', 'Antigravity IDE', '2.8.0']);
    // No variable moves its folder (the one its CLI names, ANTIGRAVITY_CONFIG_REL_DIR, changed nothing on 1.5.14).
    assert.equal(envOverride(harnesses['antigravity-cli'], { ANTIGRAVITY_CONFIG_REL_DIR: '.other/config', XDG_CONFIG_HOME: '/x' }), undefined);
  } finally { await box.cleanup(); }
});

test('An exclude entry in skills.json is read as Antigravity reads it: the folder’s name, or a path ending at the folder; no patterns', async () => {
  const box = await sandbox();
  try {
    const target = { folder: 'alpha', name: 'Alpha', skillFile: config(box.home, 'skills/alpha/SKILL.md') };
    const off = async (exclude: unknown) => {
      await writeFile(config(box.home, 'skills.json'), JSON.stringify({ exclude }));
      return isDisabled(box.context, await readSwitchFile(box.context, 'antigravity-cli'), target);
    };
    for (const entry of ['alpha', 'skills/alpha', 'config/skills/alpha', target.skillFile.replace('/SKILL.md', '')]) assert.equal(await off([entry]), true, entry);
    // Measured on 1.5.14: none of these keeps alpha out (by its name in the frontmatter, a pattern, another case, another folder).
    for (const entry of ['Alpha', 'alph*', 'alph.*', '^alpha$', 'ALPHA', 'other/alpha', 'alpha-two']) assert.equal(await off([entry]), false, entry);
  } finally { await box.cleanup(); }
});

test('A skill turned on reaches ~/.gemini/config/skills whole; Off takes that folder out; a name in exclude is its mark, never written by On or Off', async () => {
  const box = await sandbox();
  try {
    await skill(box.home, '.claude/skills', 'notes');
    await mkdir(join(box.home, '.claude/skills/notes/scripts'));
    await writeFile(join(box.home, '.claude/skills/notes/scripts/run.sh'), 'echo notes\n');
    assert.equal((await applySkills(box.context, tools, [{ key: 'notes', on: true, except: [] }])).writes, 1);
    assert.deepEqual([await readFile(config(box.home, 'skills/notes/SKILL.md'), 'utf8'), await readFile(config(box.home, 'skills/notes/scripts/run.sh'), 'utf8')], [text('notes'), 'echo notes\n']);
    // His own switch beside a key of his own.
    const his = '{\n  "exclude": ["notes"],\n  "entries": [{ "path": "~/mine" }]\n}\n';
    await writeFile(config(box.home, 'skills.json'), his);
    assert.deepEqual((await skillsView(box.context, tools)).items.find(item => item.key === 'notes')!.switchedOff, ['antigravity-cli']);
    await applySkills(box.context, tools, [{ key: 'notes', on: false, except: [] }]);
    assert.deepEqual([await exists(config(box.home, 'skills/notes')), await readFile(config(box.home, 'skills.json'), 'utf8')], [false, his]);
    await applySkills(box.context, tools, [{ key: 'notes', on: true, except: [] }]);
    assert.deepEqual([await readFile(config(box.home, 'skills/notes/scripts/run.sh'), 'utf8'), await readFile(config(box.home, 'skills.json'), 'utf8')], ['echo notes\n', his]);
    assert.equal((await applySkills(box.context, tools, [])).writes, 0, 'settled');
  } finally { await box.cleanup(); }
});

test('Undo of Let Antigravity load it puts back the entries it took out, as he wrote them, and keeps one he added since', async () => {
  const box = await sandbox();
  try {
    const exclude = async () => JSON.parse(await readFile(config(box.home, 'skills.json'), 'utf8')).exclude;
    await skill(box.home, `${CONFIG}/skills`, 'notes');
    await applySkills(box.context, tools, [{ key: 'notes', on: true, except: [] }]);
    await writeFile(config(box.home, 'skills.json'), JSON.stringify({ exclude: ['config/skills/notes', 'alpha', 'notes'] }));
    const cleared = await clearSwitch(box.context, tools, 'notes', 'antigravity-cli');
    assert.deepEqual(await exclude(), ['alpha']);
    await writeFile(config(box.home, 'skills.json'), JSON.stringify({ exclude: ['alpha', 'beta'] }));
    await restoreSkill(box.context, tools, cleared.made![0]);
    assert.deepEqual(await exclude(), ['alpha', 'beta', 'config/skills/notes', 'notes']);
  } finally { await box.cleanup(); }
});

test('Servers go to mcp_config.json in Antigravity’s form beside his own; Off takes the entry out and On puts it back with its own fields; one of his is taken in whole', async () => {
  const box = await sandbox();
  try {
    const mine = { serverUrl: 'https://example.com/mcp', headers: { 'X-Key': 'k' }, oauth: { clientId: 'id' }, enabledTools: ['search'] };
    await writeFile(config(box.home, 'mcp_config.json'), `${JSON.stringify({ mcpServers: { mine }, other: { keep: true } }, null, 2)}\n`);
    await writeFile(join(box.home, '.claude.json'), JSON.stringify({ mcpServers: {
      docs: { type: 'stdio', command: 'npx', args: ['-y', 'docs'], env: { DOCS_TOKEN: 'secret-value-123' }, cwd: '/work/docs' },
      web: { type: 'http', url: 'https://example.com/web', headers: { Authorization: 'Bearer t' } }, sse: { type: 'sse', url: 'https://example.com/sse' } } }));
    const file = async () => JSON.parse(await readFile(config(box.home, 'mcp_config.json'), 'utf8')) as { mcpServers: Record<string, Record<string, unknown>>; other: unknown };
    assert.equal((await applyServers(box.context, tools, [{ key: 'docs', on: true, except: [] }, { key: 'web', on: true, except: [] }])).writes, 2);
    assert.deepEqual(await file(), { mcpServers: { mine,
      docs: { command: 'npx', args: ['-y', 'docs'], env: { DOCS_TOKEN: 'secret-value-123' }, cwd: '/work/docs' },
      web: { serverUrl: 'https://example.com/web', headers: { Authorization: 'Bearer t' } } }, other: { keep: true } });
    assert.match((await serversView(box.context, tools)).items.find(item => item.key === 'sse')!.cannot['antigravity-cli'] ?? '', /^Antigravity has no SSE transport/);
    // His own fields on Central Knot's entry, his switch among them: read as its mark; Off takes the entry out, On gives it back whole.
    const own = await file();
    own.mcpServers.docs = { ...own.mcpServers.docs, timeoutSeconds: 30, disabled: true };
    await writeFile(config(box.home, 'mcp_config.json'), `${JSON.stringify(own, null, 2)}\n`);
    assert.deepEqual((await serversView(box.context, tools)).items.find(item => item.key === 'docs')!.switchedOff, ['antigravity-cli']);
    await applyServers(box.context, tools, [{ key: 'docs', on: false, except: [] }]);
    assert.deepEqual(Object.keys((await file()).mcpServers), ['mine', 'web']);
    await applyServers(box.context, tools, [{ key: 'docs', on: true, except: [] }]);
    assert.deepEqual((await file()).mcpServers.docs, own.mcpServers.docs);
    // His remote server taken in: the Library's form in Claude Code; in Antigravity his entry stays as it was, own fields and all.
    await applyServers(box.context, tools, [{ key: 'mine', on: true, except: [] }]);
    assert.deepEqual(JSON.parse(await readFile(join(box.home, '.claude.json'), 'utf8')).mcpServers.mine, { type: 'http', url: 'https://example.com/mcp', headers: { 'X-Key': 'k' } });
    assert.deepEqual([(await file()).mcpServers.mine, (await file()).other], [mine, { keep: true }]);
    assert.equal((await applyServers(box.context, tools, [])).writes, 0, 'settled');
  } finally { await box.cleanup(); }
});

test('A server Antigravity holds at url, or with a type, is the same Streamable HTTP server; its switch is disabled: true, which On takes out', async () => {
  const box = await sandbox();
  try {
    const text = JSON.stringify({ mcpServers: { a: { url: 'https://a.example/mcp' }, b: { url: 'https://b.example/sse', type: 'sse', disabled: true } } });
    await writeFile(config(box.home, 'mcp_config.json'), text);
    const read = await readTool(box.context, 'antigravity-cli');
    assert.deepEqual(read.entries.map(entry => [entry.name, entry.server, entry.extras]),
      [['a', { transport: 'http', url: 'https://a.example/mcp', headers: undefined }, {}], ['b', { transport: 'http', url: 'https://b.example/sse', headers: undefined }, { type: 'sse', disabled: true }]]);
    assert.deepEqual([mcpDisabled('antigravity-cli', text, 'a'), mcpDisabled('antigravity-cli', text, 'b')], [false, true]);
    assert.equal(JSON.parse(withMcpSwitch('antigravity-cli', text, 'b', false)).mcpServers.b.disabled, undefined);
    assert.equal(JSON.parse(withMcpSwitch('antigravity-cli', text, 'a', true)).mcpServers.a.disabled, true);
    assert.throws(() => withMcpSwitch('antigravity-cli', text, 'gone', true), /Antigravity has no "gone" server/);
    assert.deepEqual(ownWithoutSwitch('antigravity-cli', { name: 'b', extras: { type: 'sse', disabled: true } })?.extras, { type: 'sse' }, 'a kept own part loses only the switch');
  } finally { await box.cleanup(); }
});

test('With Antigravity’s Manage off, nothing of it is read into the Library and nothing is written there', async () => {
  const box = await sandbox();
  try {
    await skill(box.home, `${CONFIG}/skills`, 'own');
    await writeFile(config(box.home, 'mcp_config.json'), JSON.stringify({ mcpServers: { his: { command: 'his' } } }));
    await skill(box.home, '.claude/skills', 'notes');
    const managed = managedTools(await box.context.read(), ['antigravity-cli']);
    assert.deepEqual(managed, ['claude-cli']);
    await applySkills(box.context, managed, [{ key: 'notes', on: true, except: [] }]);
    await applyServers(box.context, managed, []);
    const [skills, servers] = [await skillsView(box.context, managed), await serversView(box.context, managed)];
    assert.deepEqual([skills.items.map(item => item.key), servers.items.map(item => item.key)], [['notes'], []]);
    assert.deepEqual([await exists(config(box.home, 'skills/notes')), JSON.parse(await readFile(config(box.home, 'mcp_config.json'), 'utf8'))], [false, { mcpServers: { his: { command: 'his' } } }]);
  } finally { await box.cleanup(); }
});

test('What a running Antigravity needs: a skill, nothing but /skills reload for the CLI’s slash menu; a server, /mcp in the CLI or Restart in the app, both named once', () => {
  const skillOn = [{ tool: 'antigravity-cli' as const, kind: 'skill' as const, key: 'notes', on: true }];
  const serverOn = [{ tool: 'antigravity-cli' as const, kind: 'mcp' as const, key: 'docs', on: true }];
  assert.deepEqual(reloadAdvice(skillOn).items, [{ tool: 'antigravity-cli', text: 'Antigravity reads it at the next turn; for the CLI’s slash menu, type /skills reload.',
    command: '/skills reload', chip: 'Antigravity: /skills reload', title: 'Type this in your Antigravity CLI session: its slash menu then lists the skill.' }]);
  assert.deepEqual(reloadAdvice(skillOn, { 'antigravity-cli': 'app' }).items, []);
  assert.equal(reloadAdvice(serverOn).text, 'In Antigravity, type /mcp.');
  assert.equal(reloadAdvice(serverOn, { 'antigravity-cli': 'app' }).text, 'In the Antigravity app, choose Restart on the server’s menu.');
  assert.deepEqual(reloadAdvice(serverOn, { 'antigravity-cli': 'both' }).items, [{ tool: 'antigravity-cli',
    text: 'In Antigravity, type /mcp and reload, or choose Restart on the server’s menu in the Antigravity app.', command: '/mcp', chip: 'Antigravity: /mcp',
    title: 'Type this in your Antigravity session, then reload the servers there.', more: [{ chip: 'Antigravity app: restart the server', title: 'In the Antigravity app, choose Restart on the server’s menu.' }] }]);
});

test('Its instruction file is AGENTS.md in ~/.gemini/config, never GEMINI.md, and its history is not read yet: no use and no “none seen” is said of it', async () => {
  const box = await sandbox();
  try {
    await writeFile(config(box.home, 'AGENTS.md'), 'Be brief.\n');
    await writeFile(join(box.home, '.gemini/GEMINI.md'), 'The Gemini CLI’s.\n');
    const mine = (await instructionsView(box.context, await box.context.read())).find(file => file.tool === 'antigravity-cli')!;
    assert.deepEqual([mine.path, mine.text], [config(box.home, 'AGENTS.md'), 'Be brief.\n']);
    assert.match(mine.notes.join(' '), /also reads GEMINI\.md here, and AGENTS\.md and GEMINI\.md in ~\/\.gemini/);
    assert.equal((await readUsage({ home: box.home })).tools.some(history => history.tool === 'antigravity-cli'), false);
  } finally { await box.cleanup(); }
});
