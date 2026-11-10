import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { mkdir, mkdtemp, readFile, readdir, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { cachedCatalog, checkAccess, gitFailure, whyGitFailed, install, installState, parseCatalog, readCatalog, registeredMarketplaces, sameSource, uninstall, type PluginContext } from '../src/plugins.ts';

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


/** The fixture server's base URL: its whole first line, however the output arrives in chunks. */
function servedAt(server: ChildProcess): Promise<string> {
  return new Promise(done => {
    let out = '';
    const read = (chunk: Buffer) => { out += String(chunk); if (out.includes('\n')) { server.stdout!.off('data', read); done(out.split('\n')[0]!.trim()); } };
    server.stdout!.on('data', read);
  });
}

/** Stops the fixture server and waits until it has exited, so a request made next can't still reach it. */
function stopped(server: ChildProcess): Promise<void> {
  if (server.exitCode !== null || server.signalCode !== null) return Promise.resolve();
  return new Promise(done => { server.once('exit', () => done()); server.kill(); });
}

test('A catalog lists its plugins and what each holds, and reads nothing outside the marketplace', async () => {
  const box = await sandbox();
  try {
    const root = join(box.base, 'market');
    await marketplace(root);
    const catalog = await parseCatalog(root, root, 'folder');
    assert.equal(catalog.name, 'ck-test-market');
    assert.deepEqual(catalog.plugins.map(plugin => plugin.name), ['escape', 'full', 'marker']);
    assert.deepEqual(catalog.plugins.find(plugin => plugin.name === 'full')!.components, { skills: 2, commands: 1, agents: 1, hooks: true, mcp: 1, mcpRootVariable: true, bin: false, skillNames: ['one', 'two'] });
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

test('Copilot’s whole-marketplace refusals are found before anything is added, and a tool with a different marketplace of the same name is never changed', async () => {
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
    await put(join(box.home, '.claude/settings.json'), JSON.stringify({ extraKnownMarketplaces: { 'ck-test-market': { source: { source: 'git', url: 'https://example.com/someone-else.git' } } } }));
    const other = await install(box.context, catalog, 'marker', 'claude-cli');
    assert.equal(other.outcome, 'held');
    assert.match(other.message, /different marketplace named/);
    assert.deepEqual(other.runs, []);
    await rm(join(box.home, '.claude/settings.json'));
    await put(join(box.home, '.claude/plugins/known_marketplaces.json'), JSON.stringify({ 'ck-test-market': { source: { source: 'github', repo: 'someone/else' } } }));
    assert.equal((await install(box.context, catalog, 'marker', 'claude-cli')).outcome, 'held');
    const removing = await uninstall(box.context, 'ck-test-market', 'marker', 'claude-cli', root);
    assert.equal(removing.outcome, 'held');
    assert.deepEqual(removing.runs, []);
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

test('One repository is recognised however it was typed', () => {
  assert.ok(sameSource('owner/repo', 'https://github.com/owner/repo.git'));
  assert.ok(sameSource('https://github.com/Owner/Repo', 'owner/repo'), 'GitHub ignores case in paths');
  assert.ok(!sameSource('https://git.example.com/Team/tools.git', 'https://git.example.com/team/tools.git'), 'another server may not');
  assert.ok(sameSource('git@github.com:Owner/Repo.git', 'ssh://git@github.com/owner/repo'));
  assert.ok(sameSource('https://gitlab.example.com/a/b/', 'https://gitlab.example.com/a/b.git'));
  assert.ok(!sameSource('owner/repo', 'owner/other'));
  assert.ok(sameSource('/tmp/x/../market', '/tmp/market'));
});

test('Git access failures are told apart, an ambiguous one says so, and an unknown one is shown as it is', () => {
  const samples: [number | 'timeout' | 'missing', string, string, RegExp][] = [
    ['missing', '', 'git-missing', /Git is not installed.*Install Git/],
    ['timeout', '', 'network', /Can’t reach/],
    [128, 'fatal: unable to access: Could not resolve host: x', 'network', /Can’t reach/],
    [128, 'fatal: unable to access \'http://127.0.0.1:1/x.git/\': Failed to connect to 127.0.0.1 port 1 after 0 ms: Could not connect to server', 'network', /VPN/],
    [128, 'ssh: connect to host git.example.com port 22: Connection timed out', 'network', /Can’t reach/],
    [128, 'Host key verification failed.\nfatal: Could not read from remote repository.', 'unknown-host', /SSH host is not known.*known_hosts/],
    [128, 'Enter passphrase for key \'/Users/x/.ssh/id_ed25519\':', 'passphrase', /passphrase.*SSH agent/],
    [128, 'fatal: could not read Username for \'https://x\': terminal prompts disabled', 'sign-in', /Sign-in needed, or no repository there: the server doesn’t say which/],
    [128, 'remote: HTTP Basic: Access denied\nfatal: Authentication failed for \'https://gitlab.example.com/a/b.git/\'', 'sign-in', /Sign-in needed/],
    [128, 'git@github.com: Permission denied (publickey).\nfatal: Could not read from remote repository.', 'sign-in', /credentials that already work/],
    [128, 'remote: Repository not found.\nfatal: repository \'https://github.com/a/b.git/\' not found', 'no-access', /No access, or no repository there: the server doesn’t say which/],
    [128, 'fatal: \'/srv/x\' does not appear to be a git repository', 'no-access', /Check the address/],
    [1, 'something new happened', 'unclassified', /^something new happened$/],
  ];
  for (const [code, output, state, words] of samples) {
    const failure = gitFailure(code, output);
    assert.deepEqual([failure.state, words.test(failure.message)], [state, true], `${output}: ${failure.message}`);
    assert.equal(whyGitFailed(code, output), failure.message, 'a clone and an access check word one failure the same way');
  }
});

test('The access check finds Git missing, and asks only once per source within one request', { skip: noPosix }, async () => {
  const box = await sandbox();
  const savedPath = process.env.PATH;
  try {
    process.env.PATH = join(box.base, 'empty');
    assert.equal((await checkAccess(box.context, 'http://127.0.0.1:1/x.git')).state, 'git-missing');
    process.env.PATH = savedPath;
    const checked = new Map();
    const context = { ...box.context, checked };
    const [first, second] = await Promise.all([checkAccess(context, 'http://127.0.0.1:1/x.git'), checkAccess(context, 'http://127.0.0.1:1/x.git')]);
    assert.equal(first, second);
    assert.equal(first.state, 'network');
    assert.equal(checked.size, 1);
  } finally { process.env.PATH = savedPath; await box.cleanup(); }
});

test('Before a tool is told to fetch a Git marketplace, access is checked; a failed check runs nothing, a passed one leaves the result to the tool', { skip: noPosix }, async () => {
  const box = await sandbox();
  const server = spawn(process.execPath, [join(import.meta.dirname, '../scripts/git-http-fixture.mjs'), join(box.base, 'served'), '0']);
  try {
    const root = join(box.base, 'market');
    await marketplace(root);
    const git = (args: string[], cwd: string) => execFileSync('git', args, { cwd, stdio: 'ignore' });
    git(['init', '-q'], root); git(['add', '-A'], root); git(['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'v1'], root);
    await mkdir(join(box.base, 'served'), { recursive: true });
    git(['clone', '-q', '--bare', root, join(box.base, 'served/market.git')], box.base);
    const base = await servedAt(server);
    const bin = join(box.base, 'bin');
    await mkdir(bin, { recursive: true });
    await writeFile(join(bin, 'claude'), '#!/bin/sh\necho "$*" >> "$HOME/calls.txt"\necho "add failed" >&2\nexit 1\n', { mode: 0o755 });
    const context = { ...box.context, binaries: { 'claude-cli': join(bin, 'claude') } as PluginContext['binaries'] };
    const calls = () => readFile(join(box.home, 'calls.txt'), 'utf8').catch(() => '');

    const missing = await install(context, await parseCatalog(root, `${base}/missing.git`, 'git'), 'marker', 'claude-cli');
    assert.deepEqual([missing.outcome, missing.runs.length], ['failed', 0]);
    assert.match(missing.message, /No access, or no repository there.*Nothing was added to Claude Code\./);
    assert.equal(await calls(), '', 'the tool was never run');

    const reachable = await install(context, await parseCatalog(root, `${base}/market.git`, 'git'), 'marker', 'claude-cli');
    assert.deepEqual(reachable.runs.map(run => run.command), [`claude plugin marketplace add ${base}/market.git`]);
    assert.deepEqual([reachable.outcome, reachable.message], ['failed', 'Could not add the marketplace. add failed'], 'the tool’s own result decides');

    await stopped(server);
    const unreachable = await install(context, await parseCatalog(root, `${base}/market.git`, 'git'), 'marker', 'claude-cli');
    assert.match(unreachable.message, /Can’t reach the marketplace/);
    assert.equal((await calls()).trim().split('\n').length, 1, 'only the passed check let the tool run');
  } finally { server.kill(); await box.cleanup(); }
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
    // Installed for one project only is not installed for this person: only the user scope counts.
    await put(join(box.home, '.claude/plugins/installed_plugins.json'), JSON.stringify({ version: 2, plugins: { 'p@m': [{ scope: 'project', projectPath: '/repo', installPath: cache }] } }));
    assert.equal((await installState(box.context, 'claude-cli', 'm', 'p')).state, 'not-installed');
    // A settings file saved with a byte-order mark is read like any other.
    await put(join(box.home, '.claude/plugins/installed_plugins.json'), `\uFEFF${JSON.stringify({ version: 2, plugins: { 'p@m': [{ scope: 'user', installPath: cache }] } })}`);
    assert.equal((await installState(box.context, 'claude-cli', 'm', 'p')).state, 'installed');

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
    const base = await servedAt(server);
    const url = `${base}/market.git`;
    assert.deepEqual(await checkAccess(box.context, url), { state: 'ok' });
    const catalog = await readCatalog(box.context, url);
    assert.equal(catalog.problem, undefined);
    assert.equal(catalog.kind, 'git');
    assert.deepEqual(catalog.plugins.map(plugin => plugin.name), ['escape', 'full', 'marker']);
    assert.equal((await readdir(join(box.context.dataDir, 'catalogs'))).length, 1, 'one copy, no leftovers');
    // A fetch that brings a broken marketplace.json is refused, and the last good copy stays.
    await writeFile(join(root, '.claude-plugin/marketplace.json'), '{ broken');
    git(['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qam', 'broken'], root);
    git(['push', '-q', join(box.base, 'served/market.git'), 'HEAD'], root);
    assert.match((await readCatalog(box.context, url)).problem ?? '', /could not be read as JSON/);
    assert.equal((await cachedCatalog(box.context, url))?.plugins.length, 3, 'the good copy was kept');
    assert.equal((await readdir(join(box.context.dataDir, 'catalogs'))).length, 1, 'and no stage was left');
    await stopped(server);
    // A refresh is one clone, with no access check first: its failure is classified in words a person can act on.
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
    await symlink(box.home, join(box.base, 'linked'));
    assert.ok(sameSource(join(box.base, 'linked'), box.home));
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
