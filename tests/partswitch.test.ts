import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { installedCopies, pluginParts, setPart, type PluginContext } from '../src/plugins.ts';
import { SERVER_FORM, partOff, serverHeld, withPartSwitch } from '../src/partswitch.ts';
import type { PluginTool } from '../src/presence.ts';

const at = { plugin: 'full', marketplace: 'team', kind: 'mcp' as const, name: 'issues' };
const helper = { plugin: 'full', marketplace: 'team', kind: 'agent' as const, name: 'helper' };
const put = async (path: string, text: string) => { await mkdir(join(path, '..'), { recursive: true }); await writeFile(path, text); };

test('Claude Code turns a plugin’s server off by its plugin name in the denied list, and a bare name is another server’s', () => {
  const before = '{\n  "enabledPlugins": { "full@team": true },\n  "deniedMcpServers": [{ "serverName": "issues" }]\n}\n';
  assert.equal(partOff('claude-cli', before, at), false, 'the bare name is the person’s own server, not the plugin’s');
  const off = withPartSwitch('claude-cli', before, at, true);
  assert.deepEqual(JSON.parse(off).deniedMcpServers, [{ serverName: 'issues' }, { serverName: 'plugin:full:issues' }]);
  assert.equal(partOff('claude-cli', off, at), true);
  // The list is written back as a list (JSON layout), with the same entries.
  assert.deepEqual(JSON.parse(withPartSwitch('claude-cli', off, at, false)), JSON.parse(before));
});

test('Copilot CLI turns a plugin’s server off by its bare name, as its own command does', () => {
  const off = withPartSwitch('copilot-cli', '{ "enabledPlugins": { "full@team": true } }', at, true);
  assert.deepEqual(JSON.parse(off).disabledMcpServers, ['issues']);
  assert.equal(partOff('copilot-cli', off, at), true);
  assert.equal('disabledMcpServers' in JSON.parse(withPartSwitch('copilot-cli', off, at, false)), false);
});

test('Codex turns a plugin’s server off in its own table under the plugin, and on again to the same bytes', () => {
  const before = '# mine\nmodel = "o3"\n\n[plugins."full@team"]\nenabled = true\n';
  const off = withPartSwitch('codex-cli', before, at, true);
  assert.equal(off, `${before}\n[plugins."full@team".mcp_servers.issues]\nenabled = false\n`);
  assert.equal(partOff('codex-cli', off, at), true);
  assert.equal(partOff('codex-cli', off, { ...at, name: 'other' }), false);
  assert.equal(withPartSwitch('codex-cli', off, at, false), before);
  // A server whose name needs quoting keeps it.
  assert.match(withPartSwitch('codex-cli', before, { ...at, name: 'my server' }, true), /\[plugins\."full@team"\.mcp_servers\."my server"\]\nenabled = false\n$/);
});

test('Codex keeps the person’s own keys in a server’s table, and changes only the switch', () => {
  const mine = '[plugins."full@team"]\nenabled = true\n\n[plugins."full@team".mcp_servers.issues]\n# keep\nstartup_timeout_sec = 20\n\n[other]\nx = 1\n';
  const off = withPartSwitch('codex-cli', mine, at, true);
  assert.equal(off, mine.replace('startup_timeout_sec = 20\n', 'startup_timeout_sec = 20\nenabled = false\n'));
  assert.equal(withPartSwitch('codex-cli', off, at, false), mine);
  // The person's own subtable written without the server's table stays, with the switch's table put in above it.
  const sub = '[plugins."full@team"]\nenabled = true\n\n[plugins."full@team".mcp_servers.issues.env]\nA = "1"\n';
  const subOff = withPartSwitch('codex-cli', sub, at, true);
  assert.equal(subOff, '[plugins."full@team"]\nenabled = true\n\n[plugins."full@team".mcp_servers.issues]\nenabled = false\n\n[plugins."full@team".mcp_servers.issues.env]\nA = "1"\n');
  assert.equal(partOff('codex-cli', subOff, at), true);
  assert.equal(withPartSwitch('codex-cli', subOff, at, false), sub, 'on again, the file is as it was');
  // An explicit `enabled = true` is replaced, and taken out again when it is turned back on: on is the default.
  const explicit = mine.replace('startup_timeout_sec = 20\n', 'startup_timeout_sec = 20\nenabled = true\n');
  assert.equal(partOff('codex-cli', explicit, at), false);
  assert.equal(withPartSwitch('codex-cli', explicit, at, true), off);
});

test('a Codex file that sets the plugin’s servers as a value is read and never edited', () => {
  for (const inline of ['[plugins."full@team"]\nenabled = true\nmcp_servers = { issues = { enabled = true } }\n', '[plugins."full@team".mcp_servers]\nissues.enabled = true\n', 'plugins = { "full@team" = { enabled = true } }\n']) {
    assert.throws(() => withPartSwitch('codex-cli', inline, at, true), { message: SERVER_FORM }, inline);
  }
  // Such a file still says what it turns off (the box shows it), and why it can't be switched, before any click.
  for (const off of ['[plugins."full@team"]\nmcp_servers = { issues = { enabled = false } }\n', '[plugins."full@team".mcp_servers]\nissues.enabled = false\n', '[plugins."full@team"]\nmcp_servers.issues.enabled = false\n']) {
    assert.deepEqual([partOff('codex-cli', off, at), serverHeld(off, at)], [true, SERVER_FORM], off);
    assert.throws(() => withPartSwitch('codex-cli', off, at, false), { message: SERVER_FORM }, off);
  }
  // Another server's value under the same table is no obstacle.
  assert.doesNotThrow(() => withPartSwitch('codex-cli', '[plugins."full@team".mcp_servers]\nother.enabled = true\n', at, true));
  assert.equal(serverHeld('[plugins."full@team".mcp_servers]\nother.enabled = true\n', at), undefined);
});

test('Claude Code turns a plugin’s agent off with a deny rule in its settings, and takes only that rule out again', () => {
  const before = '{\n  "permissions": { "allow": ["Read"], "deny": ["Bash(rm *)"] }\n}\n';
  const off = withPartSwitch('claude-cli', before, helper, true);
  assert.deepEqual(JSON.parse(off).permissions, { allow: ['Read'], deny: ['Bash(rm *)', 'Agent(full:helper)'] });
  assert.equal(partOff('claude-cli', off, helper), true);
  assert.deepEqual(JSON.parse(withPartSwitch('claude-cli', off, helper, false)), JSON.parse(before));
  // The rule under the tool's older name is read the same, and goes too.
  const older = '{ "permissions": { "deny": ["Task(full:helper)"] } }';
  assert.equal(partOff('claude-cli', older, helper), true);
  assert.deepEqual(JSON.parse(withPartSwitch('claude-cli', older, helper, false)), {});
  // A deny list this made goes with its last rule, and `permissions` only when it held nothing else.
  assert.deepEqual(JSON.parse(withPartSwitch('claude-cli', withPartSwitch('claude-cli', '{ "permissions": { "allow": ["Read"] } }', helper, true), helper, false)), { permissions: { allow: ['Read'] } });
  assert.deepEqual(JSON.parse(withPartSwitch('claude-cli', withPartSwitch('claude-cli', '', helper, true), helper, false)), {});
});

test('Copilot CLI and Codex have no switch for one agent of a plugin: read as on, never written', () => {
  for (const tool of ['copilot-cli', 'codex-cli'] as const) {
    assert.equal(partOff(tool, '', helper), false);
    assert.throws(() => withPartSwitch(tool, '', helper, true), { code: 'CK_FORM' });
  }
});

/** A home where `tool` has team's plugin `full` installed (skill `one`; MCP servers `issues` and `wiki`; agent `helper`), from the marketplace at /m. */
async function homeWith(tool: PluginTool) {
  const base = await realpath(await mkdtemp(join(tmpdir(), 'ck-plugin-server-')));
  const home = join(base, 'home');
  const context: PluginContext = { home, dataDir: join(base, 'data'), binaries: {}, timeoutMs: 20_000 };
  const copy = { 'claude-cli': join(home, '.claude/plugins/cache/team/full/1.0.0'), 'copilot-cli': join(home, '.copilot/installed-plugins/team/full'), 'codex-cli': join(home, '.codex/plugins/cache/team/full/1.0.0') }[tool];
  await put(join(copy, '.claude-plugin/plugin.json'), JSON.stringify({ name: 'full', version: '1.0.0' }));
  await put(join(copy, '.codex-plugin/plugin.json'), JSON.stringify({ name: 'full', version: '1.0.0', skills: './skills', mcpServers: './.mcp.json' }));
  await put(join(copy, 'skills/one/SKILL.md'), '---\nname: one\ndescription: One.\n---\nB\n');
  await put(join(copy, 'agents/helper.md'), '---\nname: helper\ndescription: Helps.\n---\nYou help.\n');
  await put(join(copy, '.mcp.json'), JSON.stringify({ mcpServers: { issues: { command: 'npx', args: ['issues'] }, wiki: { url: 'https://wiki.example/mcp' } } }));
  const market = { team: { source: { source: 'directory', path: '/m' } } };
  let file: string;
  if (tool === 'claude-cli') {
    file = join(home, '.claude/settings.json');
    await put(join(home, '.claude/plugins/installed_plugins.json'), JSON.stringify({ version: 2, plugins: { 'full@team': [{ scope: 'user', installPath: copy, version: '1.0.0' }] } }));
    await put(file, `${JSON.stringify({ extraKnownMarketplaces: market, enabledPlugins: { 'full@team': true } }, null, 2)}\n`);
  } else if (tool === 'copilot-cli') {
    file = join(home, '.copilot/settings.json');
    await put(join(home, '.copilot/config.json'), JSON.stringify({ installedPlugins: [{ name: 'full', marketplace: 'team', version: '1.0.0', cache_path: copy, enabled: true }] }));
    await put(file, `${JSON.stringify({ extraKnownMarketplaces: market }, null, 2)}\n`);
  } else {
    file = join(home, '.codex/config.toml');
    await put(file, '[marketplaces.team]\nsource = "/m"\n\n[plugins."full@team"]\nenabled = true\n');
  }
  const filesIn = async (folder: string) => Object.fromEntries(await Promise.all((await readdir(folder, { recursive: true, withFileTypes: true })).filter(entry => entry.isFile())
    .map(async entry => [join(entry.parentPath, entry.name), await readFile(join(entry.parentPath, entry.name), 'utf8')] as const)));
  return { context, copy, file, filesIn, cleanup: () => rm(base, { recursive: true, force: true }) };
}

for (const tool of ['claude-cli', 'copilot-cli', 'codex-cli'] as PluginTool[]) {
  test(`${tool}: one server of an installed plugin goes off and on with the tool’s own switch, read back, and the plugin’s files never change`, async () => {
    const { context, copy, file, filesIn, cleanup } = await homeWith(tool);
    try {
      const original = await readFile(file, 'utf8');
      const plugin = await filesIn(copy);
      const offIn = async () => (await installedCopies({ ...context, reads: new Map() }, tool))[0]?.serversOff ?? [];
      assert.deepEqual(await offIn(), []);

      const off = await setPart(context, 'team', 'full', { kind: 'mcp', name: 'issues' }, tool, false, '/m');
      assert.deepEqual([off.outcome, off.changed, off.runs[0]?.changed[0]?.path], ['part-off', true, file], off.message);
      assert.deepEqual(await offIn(), ['issues']);
      // The pages' boxes say it: that server is off there, the other is not.
      const parts = (await pluginParts({ ...context, reads: new Map() }, tool)).filter(part => part.kind === 'mcp');
      // (Codex's servers are listed on the plugin's own rows only: an own row never counts one as there through the plugin.)
      assert.deepEqual(parts.map(part => [part.name, part.off]), tool === 'codex-cli' ? [] : [['issues', true], ['wiki', undefined]]);
      assert.deepEqual([(await setPart(context, 'team', 'full', { kind: 'mcp', name: 'issues' }, tool, false, '/m')).changed, (await readdir(join(context.dataDir, 'native'))).length], [undefined, 1], 'off again changes nothing, and the one write kept its bytes');

      const on = await setPart(context, 'team', 'full', { kind: 'mcp', name: 'issues' }, tool, true, '/m');
      assert.deepEqual([on.outcome, on.changed], ['part-on', true], on.message);
      assert.equal(await readFile(file, 'utf8'), original, 'on again, the file is as it was');
      assert.deepEqual(await filesIn(copy), plugin);
    } finally { await cleanup(); }
  });
}

test('a server the installed copy lacks, a plugin not installed and another marketplace of that name each fail with the reason, and nothing is written', async () => {
  const { context, file, cleanup } = await homeWith('codex-cli');
  try {
    const original = await readFile(file, 'utf8');
    const missing = await setPart(context, 'team', 'full', { kind: 'mcp', name: 'nope' }, 'codex-cli', false, '/m');
    assert.deepEqual([missing.outcome, missing.message], ['failed', 'The copy Codex has installed has no MCP server named “nope”.']);
    assert.deepEqual((await setPart(context, 'team', 'gone', { kind: 'mcp', name: 'issues' }, 'codex-cli', false, '/m')).message, 'It isn’t installed in Codex now.');
    assert.equal((await setPart(context, 'team', 'full', { kind: 'mcp', name: 'issues' }, 'codex-cli', false, '/elsewhere')).outcome, 'held');
    assert.equal(await readFile(file, 'utf8'), original);
  } finally { await cleanup(); }
});

test('Claude Code: one agent of an installed plugin goes off and on, and its box says so; Copilot CLI says it has no such switch', async () => {
  const { context, file, cleanup } = await homeWith('claude-cli');
  try {
    const original = await readFile(file, 'utf8');
    const off = await setPart(context, 'team', 'full', { kind: 'agent', name: 'helper' }, 'claude-cli', false, '/m');
    assert.deepEqual([off.outcome, off.changed], ['part-off', true], off.message);
    assert.deepEqual(JSON.parse(await readFile(file, 'utf8')).permissions, { deny: ['Agent(full:helper)'] });
    assert.deepEqual((await pluginParts({ ...context, reads: new Map() }, 'claude-cli')).filter(part => part.kind === 'agent').map(part => [part.name, part.off]), [['helper', true]]);
    assert.equal((await setPart(context, 'team', 'full', { kind: 'agent', name: 'helper' }, 'claude-cli', true, '/m')).outcome, 'part-on');
    assert.deepEqual(JSON.parse(await readFile(file, 'utf8')), JSON.parse(original));
    const none = await setPart(context, 'team', 'full', { kind: 'agent', name: 'helper' }, 'copilot-cli', false, '/m');
    assert.deepEqual([none.outcome, none.message], ['failed', 'Copilot CLI has no switch for one agent of a plugin.']);
  } finally { await cleanup(); }
});
