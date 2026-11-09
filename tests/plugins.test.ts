import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { mkdir, mkdtemp, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { cachedCatalog, checkAccess, classify, install, installState, outcomes, parseCatalog, readCatalog, readCodexTables, sameSource, type PluginContext } from '../src/plugins.ts';

const noPosix = process.platform === 'win32';

async function sandbox() {
  const base = await realpath(await mkdtemp(join(tmpdir(), 'ck-plugins-')));
  const home = join(base, 'home');
  await mkdir(home, { recursive: true });
  return { base, home, context: { home, dataDir: join(base, 'data'), binaries: {}, timeoutMs: 20_000 } as PluginContext, cleanup: () => rm(base, { recursive: true, force: true }) };
}

const put = async (path: string, text: string) => { await mkdir(join(path, '..'), { recursive: true }); await writeFile(path, text); };

/** A marketplace with a full plugin, a skill-only plugin, one outside the folder and one from npm. */
async function marketplace(root: string, extra: unknown[] = []) {
  await put(join(root, '.claude-plugin/marketplace.json'), JSON.stringify({
    name: 'ck-test-market', owner: { name: 'tests' },
    plugins: [
      { name: 'full', source: './plugins/full', description: 'Everything', version: '1.0.0' },
      { name: 'marker', source: './plugins/marker', description: 'One skill' },
      { name: 'escape', source: '../outside', description: 'Outside the marketplace' },
      ...extra,
    ],
  }));
  const full = join(root, 'plugins/full');
  await put(join(full, '.claude-plugin/plugin.json'), JSON.stringify({ name: 'full', version: '1.0.0' }));
  await put(join(full, 'skills/one/SKILL.md'), '---\nname: one\ndescription: One.\n---\nB\n');
  await put(join(full, 'skills/two/SKILL.md'), '---\nname: two\ndescription: Two.\n---\nB\n');
  await put(join(full, 'commands/go.md'), 'Go.\n');
  await put(join(full, 'agents/helper.md'), 'Helper.\n');
  await put(join(full, 'hooks/hooks.json'), '{}');
  await put(join(full, '.mcp.json'), JSON.stringify({ mcpServers: { local: { command: '${CLAUDE_PLUGIN_ROOT}/server' } } }));
  await put(join(root, 'plugins/marker/skills/ck-marker-skill/SKILL.md'), '---\nname: ck-marker-skill\ndescription: Marker.\n---\nReply ck-mk-1.\n');
}

test('A catalog lists its plugins and what each holds, and reads nothing outside the marketplace', async () => {
  const box = await sandbox();
  try {
    const root = join(box.base, 'market');
    await marketplace(root);
    const catalog = await parseCatalog(root, root, 'folder');
    assert.equal(catalog.name, 'ck-test-market');
    assert.deepEqual(catalog.plugins.map(plugin => plugin.name), ['escape', 'full', 'marker']);
    assert.deepEqual(catalog.plugins.find(plugin => plugin.name === 'full')!.components, { skills: 2, commands: 1, agents: 1, hooks: true, mcp: 1, mcpRootVariable: true, bin: false, skillNames: catalog.plugins.find(plugin => plugin.name === 'full')!.components!.skillNames });
    assert.equal(catalog.plugins.find(plugin => plugin.name === 'full')!.components!.skillNames!.length, 2);
    assert.equal(catalog.plugins.find(plugin => plugin.name === 'escape')!.components, undefined, 'a path outside is not read');
    assert.equal(catalog.plugins.some(plugin => plugin.copilotRefuses), false);
  } finally { await box.cleanup(); }
});

test('Copilot’s whole-marketplace refusals are found before anything is added', async () => {
  const box = await sandbox();
  try {
    const root = join(box.base, 'market');
    await marketplace(root, [{ name: 'from-npm', source: { source: 'npm', package: 'x' } }, { name: 'scp', source: { source: 'url', url: 'git@host:org/repo.git' } }]);
    const catalog = await parseCatalog(root, root, 'folder');
    assert.match(catalog.plugins.find(plugin => plugin.name === 'from-npm')!.copilotRefuses ?? '', /npm/);
    assert.match(catalog.plugins.find(plugin => plugin.name === 'scp')!.copilotRefuses ?? '', /SCP/);
    const report = await install(box.context, catalog, 'marker', 'copilot-cli');
    assert.equal(report.outcome, 'held');
    assert.deepEqual(report.runs, [], 'nothing was run');
  } finally { await box.cleanup(); }
});

test('Folders and missing manifests get a plain message', async () => {
  const box = await sandbox();
  try {
    const catalog = await parseCatalog(box.base, box.base, 'folder');
    assert.match(catalog.problem ?? '', /no marketplace here/);
  } finally { await box.cleanup(); }
});

test('Each tool’s outcome per component follows the tested results', () => {
  const components = { skills: 1, commands: 1, agents: 1, hooks: true, mcp: 1, mcpRootVariable: true, bin: false };
  const codex = Object.fromEntries(outcomes('codex-cli', components).map(item => [item.component, item.result]));
  assert.deepEqual(codex, { Skills: 'works', Commands: 'limited', Agents: 'ignored', Hooks: 'limited', 'MCP servers': 'fails' });
  assert.ok(outcomes('claude-cli', components).every(item => item.result === 'works'));
  assert.equal(outcomes('copilot-cli', components).find(item => item.component === 'Commands')!.text, 'become skills');
});

test('One repository is recognised however it was typed', () => {
  assert.ok(sameSource('owner/repo', 'https://github.com/owner/repo.git'));
  assert.ok(sameSource('git@github.com:Owner/Repo.git', 'ssh://git@github.com/owner/repo'));
  assert.ok(sameSource('https://gitlab.example.com/a/b/', 'https://gitlab.example.com/a/b.git'));
  assert.ok(!sameSource('owner/repo', 'owner/other'));
  assert.ok(sameSource('/tmp/x/../market', '/tmp/market'));
});

test('Git access failures are told apart, and an unknown one is shown as it is', () => {
  assert.equal(classify('missing', '').state, 'git-missing');
  assert.equal(classify('timeout', '').state, 'network');
  assert.equal(classify(128, 'fatal: unable to access: Could not resolve host: x').state, 'network');
  assert.equal(classify(128, 'Host key verification failed.').state, 'unknown-host');
  assert.equal(classify(128, 'Enter passphrase for key').state, 'passphrase');
  assert.equal(classify(128, 'fatal: could not read Username for https://x: terminal prompts disabled').state, 'sign-in');
  assert.equal(classify(128, 'remote: Repository not found.').state, 'no-access');
  const odd = classify(1, 'something new happened');
  assert.equal(odd.state, 'unclassified');
  assert.match('message' in odd ? odd.message : '', /something new happened/);
});

test('Only Codex’s marketplace and plugin tables are read from config.toml', () => {
  const tables = readCodexTables([
    'model = "x"', '# a comment', '[marketplaces.ck-test-market]', 'source_type = "git"', 'source = "http://127.0.0.1:1/market.git" # trailing',
    '', '[plugins."ck-marker@ck-test-market"]', 'enabled = true', '[mcp_servers.other]', 'command = "no"',
  ].join('\n'));
  assert.equal(tables.marketplaces['ck-test-market']?.source, 'http://127.0.0.1:1/market.git');
  assert.equal(tables.plugins['ck-marker@ck-test-market']?.enabled, 'true');
  assert.equal(Object.keys(tables.plugins).length, 1);
});

test('Installed means files where the tool records them; a record with no files is Not known yet', async () => {
  const box = await sandbox();
  try {
    const cache = join(box.home, '.claude/plugins/cache/m/p/1.0.0');
    await put(join(box.home, '.claude/plugins/installed_plugins.json'), JSON.stringify({ version: 2, plugins: { 'p@m': [{ scope: 'user', installPath: cache }] } }));
    assert.equal((await installState(box.context, 'claude-cli', 'm', 'p')).state, 'not-known');
    await put(join(cache, 'skills/s/SKILL.md'), 'x');
    assert.equal((await installState(box.context, 'claude-cli', 'm', 'p')).state, 'installed');
    assert.equal((await installState(box.context, 'claude-cli', 'm', 'other')).state, 'not-installed');

    const copied = join(box.home, '.copilot/installed-plugins/m/p');
    await put(join(box.home, '.copilot/config.json'), `// User settings belong in settings.json.\n// This file is managed automatically.\n${JSON.stringify({ installedPlugins: [{ name: 'p', marketplace: 'm', cache_path: copied, enabled: true }] })}`);
    assert.equal((await installState(box.context, 'copilot-cli', 'm', 'p')).state, 'not-known');
    await put(join(copied, 'skills/s/SKILL.md'), 'x');
    assert.equal((await installState(box.context, 'copilot-cli', 'm', 'p')).state, 'installed');

    const live = join(box.base, 'live-market');
    await marketplace(live);
    await put(join(box.home, '.copilot/settings.json'), JSON.stringify({ extraKnownMarketplaces: { 'ck-test-market': { source: { source: 'directory', path: live } } }, enabledPlugins: { 'marker@ck-test-market': true } }));
    const liveState = await installState(box.context, 'copilot-cli', 'ck-test-market', 'marker');
    assert.ok(liveState.state === 'installed' && liveState.live, JSON.stringify(liveState));

    await put(join(box.home, '.codex/config.toml'), '[plugins."p@m"]\nenabled = true\n');
    assert.equal((await installState(box.context, 'codex-cli', 'm', 'p')).state, 'not-known');
    await put(join(box.home, '.codex/plugins/cache/m/p/1.0.0/skills/s/SKILL.md'), 'x');
    assert.equal((await installState(box.context, 'codex-cli', 'm', 'p')).state, 'installed');
  } finally { await box.cleanup(); }
});

test('A tool with a different marketplace of the same name is never changed', async () => {
  const box = await sandbox();
  try {
    const root = join(box.base, 'market');
    await marketplace(root);
    await put(join(box.home, '.claude/settings.json'), JSON.stringify({ extraKnownMarketplaces: { 'ck-test-market': { source: { source: 'git', url: 'https://example.com/someone-else.git' } } } }));
    const report = await install({ ...box.context, binaries: { 'claude-cli': '/bin/false' } }, await parseCatalog(root, root, 'folder'), 'marker', 'claude-cli');
    assert.equal(report.outcome, 'held');
    assert.match(report.message, /different marketplace named/);
    assert.deepEqual(report.runs, []);
  } finally { await box.cleanup(); }
});

test('A Git marketplace is checked, then read from a fresh shallow copy; the last copy stays browsable', { skip: noPosix }, async () => {
  const box = await sandbox();
  const server = spawn(process.execPath, [join(import.meta.dirname, '../scripts/git-http-fixture.mjs'), join(box.base, 'served'), '0']);
  try {
    const root = join(box.base, 'market');
    await marketplace(root);
    const git = (args: string[], cwd: string) => execFileSync('git', args, { cwd, stdio: 'ignore' });
    git(['init', '-q'], root); git(['add', '-A'], root); git(['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'v1'], root);
    await mkdir(join(box.base, 'served'), { recursive: true });
    git(['clone', '-q', '--bare', root, join(box.base, 'served/market.git')], box.base);
    const base = await new Promise<string>(done => server.stdout.once('data', chunk => done(String(chunk).trim())));
    const url = `${base}/market.git`;
    assert.deepEqual(await checkAccess(url), { state: 'ok' });
    const catalog = await readCatalog(box.context, url);
    assert.equal(catalog.problem, undefined);
    assert.equal(catalog.kind, 'git');
    assert.deepEqual(catalog.plugins.map(plugin => plugin.name), ['escape', 'full', 'marker']);
    assert.equal((await readdir(join(box.context.dataDir, 'catalogs'))).length, 1, 'one copy, no leftovers');
    server.kill();
    const missing = await checkAccess(`${base}/market.git`);
    assert.equal(missing.state, 'network');
    assert.equal((await cachedCatalog(box.context, url))?.plugins.length, 3, 'the last fetched catalog stays browsable');
  } finally { server.kill(); await box.cleanup(); }
});
