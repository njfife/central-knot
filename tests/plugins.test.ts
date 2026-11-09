import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { mkdir, mkdtemp, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { outcomes } from '../src/pluginoutcomes.ts';
import { cachedCatalog, classify, install, installState, parseCatalog, readCatalog, registeredMarketplaces, sameSource, uninstall, type PluginContext } from '../src/plugins.ts';

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
  await put(join(full, 'hooks/hooks.json'), JSON.stringify({ hooks: { SessionStart: [] } }));
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
    assert.equal(catalog.copilotRefuses, undefined);
  } finally { await box.cleanup(); }
});

test('A bare plugin source is looked up under metadata.pluginRoot; a ./ path starts at the marketplace root', async () => {
  const box = await sandbox();
  try {
    const root = join(box.base, 'market');
    await put(join(root, '.claude-plugin/marketplace.json'), JSON.stringify({ name: 'm', metadata: { pluginRoot: './plugins' }, plugins: [{ name: 'bare', source: 'bare' }, { name: 'rooted', source: './rooted' }] }));
    await put(join(root, 'plugins/bare/skills/a/SKILL.md'), '---\nname: a\n---\n');
    await put(join(root, 'rooted/skills/b/SKILL.md'), '---\nname: b\n---\n');
    const catalog = await parseCatalog(root, root, 'folder');
    assert.deepEqual(catalog.plugins.map(plugin => [plugin.name, plugin.folder, plugin.components?.skills]), [['bare', join(root, 'plugins/bare'), 1], ['rooted', join(root, 'rooted'), 1]]);
    assert.equal((await parseCatalog(root, root, 'folder', { counts: false })).plugins[0]!.components, undefined, 'counts are skipped when not asked for');
  } finally { await box.cleanup(); }
});

test('Copilot’s whole-marketplace refusals are found before anything is added', async () => {
  const box = await sandbox();
  try {
    const root = join(box.base, 'market');
    await marketplace(root, [{ name: 'from-npm', source: { source: 'npm', package: 'x' } }, { name: 'scp', source: { source: 'url', url: 'git@host:org/repo.git' } }]);
    const catalog = await parseCatalog(root, root, 'folder');
    assert.match(catalog.copilotRefuses ?? '', /npm/, 'the first refusing entry is named');
    const scpOnly = join(box.base, 'scp-only');
    await marketplace(scpOnly, [{ name: 'scp', source: { source: 'url', url: 'git@host:org/repo.git' } }]);
    assert.match((await parseCatalog(scpOnly, scpOnly, 'folder')).copilotRefuses ?? '', /SCP/);
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
    // A large marketplace.json is read whole (past the limit for other files); one past its own limit says so.
    const big = join(box.base, 'big');
    const many = Array.from({ length: 3000 }, (_, index) => ({ name: `p${index}`, source: { source: 'npm', package: 'x' }, description: 'x'.repeat(100) }));
    await put(join(big, '.claude-plugin/marketplace.json'), JSON.stringify({ name: 'big', plugins: many }));
    assert.equal((await parseCatalog(big, big, 'folder')).plugins.length, 3000);
    await put(join(big, '.claude-plugin/marketplace.json'), JSON.stringify({ name: 'big', padding: 'x'.repeat(9 * 1024 * 1024) }));
    assert.match((await parseCatalog(big, big, 'folder')).problem ?? '', /larger than 8 MB/);
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
  assert.ok(sameSource('https://github.com/Owner/Repo', 'owner/repo'), 'GitHub ignores case in paths');
  assert.ok(!sameSource('https://git.example.com/Team/tools.git', 'https://git.example.com/team/tools.git'), 'another server may not');
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

test('Each tool’s marketplaces are read from where it records them', async () => {
  const box = await sandbox();
  try {
    await put(join(box.home, '.codex/config.toml'), [
      'model = "x"', '# a comment', '[marketplaces.ck-test-market]', 'source_type = "git"', 'source = "http://127.0.0.1:1/market.git" # trailing',
      '', '[plugins."ck-marker@ck-test-market"]', 'enabled = true', '[mcp_servers.other]', 'command = "no"',
    ].join('\n'));
    assert.deepEqual(await registeredMarketplaces(box.context, 'codex-cli'), [{ name: 'ck-test-market', source: 'http://127.0.0.1:1/market.git' }]);
    await put(join(box.home, '.codex/plugins/cache/ck-test-market/ck-marker/1/skills/s/SKILL.md'), 'x');
    assert.equal((await installState(box.context, 'codex-cli', 'ck-test-market', 'ck-marker')).state, 'installed');

    // Claude Code's own command records marketplaces in known_marketplaces.json; settings.json may name more.
    await put(join(box.home, '.claude/plugins/known_marketplaces.json'), JSON.stringify({ official: { source: { source: 'github', repo: 'anthropics/claude-plugins-official' }, installLocation: '/x', lastUpdated: 'now' } }));
    await put(join(box.home, '.claude/settings.json'), JSON.stringify({ extraKnownMarketplaces: { team: { source: { source: 'directory', path: '/srv/team' } }, official: { source: { source: 'git', url: 'https://example.com/other.git' } } } }));
    assert.deepEqual(await registeredMarketplaces(box.context, 'claude-cli'), [{ name: 'official', source: 'anthropics/claude-plugins-official' }, { name: 'team', source: '/srv/team' }]);
    assert.deepEqual(await registeredMarketplaces(box.context, 'copilot-cli'), []);
  } finally { await box.cleanup(); }
});

test('A tool’s record of an odd shape reads as not installed, never as an error', async () => {
  const box = await sandbox();
  try {
    await put(join(box.home, '.claude/plugins/installed_plugins.json'), JSON.stringify({ plugins: { 'p@m': 'not a list', 'q@m': [null, 4, { installPath: 7 }] } }));
    await put(join(box.home, '.copilot/config.json'), JSON.stringify({ installedPlugins: { name: 'p' } }));
    await put(join(box.home, '.copilot/settings.json'), JSON.stringify({ enabledPlugins: { 'p@m': true }, extraKnownMarketplaces: { m: { source: 'directory' } } }));
    await put(join(box.home, '.codex/config.toml'), '[plugins\nbroken');
    for (const [tool, plugin] of [['claude-cli', 'p'], ['claude-cli', 'q'], ['copilot-cli', 'p'], ['codex-cli', 'p']] as const) {
      assert.equal((await installState(box.context, tool, 'm', plugin)).state, 'not-installed', `${tool} ${plugin}`);
    }
  } finally { await box.cleanup(); }
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
    // Recorded by Claude Code's own command, the other marketplace is held just the same, for uninstall too.
    await rm(join(box.home, '.claude/settings.json'));
    await put(join(box.home, '.claude/plugins/known_marketplaces.json'), JSON.stringify({ 'ck-test-market': { source: { source: 'github', repo: 'someone/else' } } }));
    const again = await install({ ...box.context, binaries: { 'claude-cli': '/bin/false' } }, await parseCatalog(root, root, 'folder'), 'marker', 'claude-cli');
    assert.equal(again.outcome, 'held');
    const removing = await uninstall({ ...box.context, binaries: { 'claude-cli': '/bin/false' } }, 'ck-test-market', 'marker', 'claude-cli', root);
    assert.equal(removing.outcome, 'held');
    assert.deepEqual(removing.runs, []);
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
    const catalog = await readCatalog(box.context, url);
    assert.equal(catalog.problem, undefined);
    assert.equal(catalog.kind, 'git');
    assert.deepEqual(catalog.plugins.map(plugin => plugin.name), ['escape', 'full', 'marker']);
    assert.equal((await readdir(join(box.context.dataDir, 'catalogs'))).length, 1, 'one copy, no leftovers');
    server.kill();
    // One clone, no separate access check: its failure is classified in words a person can act on.
    assert.match((await readCatalog(box.context, url)).problem ?? '', /Can’t reach the marketplace/);
    assert.equal((await cachedCatalog(box.context, url))?.plugins.length, 3, 'the last fetched catalog stays browsable');
  } finally { server.kill(); await box.cleanup(); }
});

test('A CLI that is a script finds its interpreter beside it, even when the app was opened with a short PATH', { skip: noPosix }, async () => {
  const box = await sandbox();
  const savedPath = process.env.PATH;
  try {
    const root = join(box.base, 'market');
    await marketplace(root);
    // A Node-style CLI: `#!/usr/bin/env fakenode` with fakenode in the same folder, as Homebrew installs Codex beside node.
    const bin = join(box.base, 'bin');
    await mkdir(bin, { recursive: true });
    await writeFile(join(bin, 'fakenode'), '#!/bin/sh\necho "ran $2" >> "$HOME/calls.txt"\nexit 3\n', { mode: 0o755 });
    await writeFile(join(bin, 'codex'), '#!/usr/bin/env fakenode\n', { mode: 0o755 });
    process.env.PATH = '/usr/bin:/bin';
    const report = await install({ ...box.context, binaries: { 'codex-cli': join(bin, 'codex') } }, await parseCatalog(root, root, 'folder'), 'marker', 'codex-cli');
    assert.ok(report.runs.length > 0, JSON.stringify(report));
    assert.doesNotMatch(report.runs[0]!.output, /No such file or directory/, report.runs[0]!.output);
  } finally { process.env.PATH = savedPath; await box.cleanup(); }
});

test('A folder marketplace named through a link is the same marketplace, so it is listed once', { skip: noPosix }, async () => {
  const box = await sandbox();
  try {
    const real = join(box.base, 'market');
    await marketplace(real);
    const { symlink } = await import('node:fs/promises');
    await symlink(real, join(box.base, 'linked'));
    assert.ok(sameSource(join(box.base, 'linked'), real));
    assert.ok(sameSource(`${real}/`, real));
    assert.ok(!sameSource(join(box.base, 'other'), real));
  } finally { await box.cleanup(); }
});

test('A plugin from another repository is copied once; a pinned commit that can’t be read leaves no copy behind', { skip: noPosix }, async () => {
  const box = await sandbox();
  try {
    const repo = join(box.base, 'repo');
    await put(join(repo, 'plugin/skills/hello/SKILL.md'), '---\nname: hello\n---\n');
    execFileSync('git', ['init', '-q', '-b', 'main', repo]);
    execFileSync('git', ['-C', repo, '-c', 'user.email=t@t', '-c', 'user.name=t', 'add', '.']);
    execFileSync('git', ['-C', repo, '-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'one']);
    const { readRemotePlugin, remoteCopyFolder } = await import('../src/plugins.ts');
    const remote = { url: `file://${repo}`, path: 'plugin' };
    const [first, second] = await Promise.all([readRemotePlugin(box.context, remote), readRemotePlugin(box.context, remote)]);
    assert.ok('folder' in first && 'folder' in second && first.folder === second.folder, JSON.stringify([first, second]));
    const pinned = { ...remote, sha: 'deadbeefdeadbeef' };
    const failed = await readRemotePlugin(box.context, pinned);
    assert.ok('problem' in failed && /could not be read/.test(failed.problem), JSON.stringify(failed));
    const { stat } = await import('node:fs/promises');
    assert.equal(await stat(remoteCopyFolder(box.context, pinned)).then(() => true, () => false), false, 'the branch head is never kept in its place');
  } finally { await box.cleanup(); }
});

test('A successful install and uninstall through Claude Code’s own CLI are each a real change, read back from its record', { skip: noPosix }, async () => {
  const box = await sandbox();
  try {
    const root = join(box.base, 'market');
    await marketplace(root);
    // A stand-in for `claude` that writes the files Claude Code keeps: the marketplace in known_marketplaces.json, the install in
    // plugins/installed_plugins.json with its files at installPath.
    const bin = join(box.base, 'bin');
    await mkdir(bin, { recursive: true });
    await writeFile(join(bin, 'claude'), `#!/bin/sh
set -e
mkdir -p "$HOME/.claude/plugins"
case "$2 $3" in
  "marketplace add") printf '{"ck-test-market":{"source":{"source":"directory","path":"%s"},"installLocation":"%s"}}' "$4" "$4" > "$HOME/.claude/plugins/known_marketplaces.json" ;;
  "install marker@ck-test-market") mkdir -p "$HOME/.claude/plugins/cache/marker" && echo x > "$HOME/.claude/plugins/cache/marker/plugin.json"
    printf '{"plugins":{"marker@ck-test-market":[{"scope":"user","installPath":"%s"}]}}' "$HOME/.claude/plugins/cache/marker" > "$HOME/.claude/plugins/installed_plugins.json" ;;
  "uninstall marker@ck-test-market") printf '{"plugins":{}}' > "$HOME/.claude/plugins/installed_plugins.json" ;;
esac
`, { mode: 0o755 });
    const context = { ...box.context, binaries: { 'claude-cli': join(bin, 'claude') } as PluginContext['binaries'] };
    const catalog = await parseCatalog(root, root, 'folder');
    const installed = await install(context, catalog, 'marker', 'claude-cli');
    assert.deepEqual([installed.outcome, installed.changed], ['installed', true], installed.message);
    assert.ok(installed.runs.some(run => run.changed.some(change => change.path.endsWith('installed_plugins.json') && change.before === null && change.after)), 'the bytes before and after are kept');
    const again = await install(context, catalog, 'marker', 'claude-cli');
    assert.deepEqual([again.outcome, again.changed], ['installed', undefined], 'already installed is not a change');
    const removed = await uninstall(context, 'ck-test-market', 'marker', 'claude-cli', root);
    assert.deepEqual([removed.outcome, removed.changed], ['uninstalled', true], removed.message);
    const back = await install(context, catalog, 'marker', 'claude-cli');
    assert.deepEqual(back.runs.map(run => run.command), ['claude plugin install marker@ck-test-market --scope user'], 'the marketplace Claude Code recorded is found, so it isn’t added twice');
  } finally { await box.cleanup(); }
});
