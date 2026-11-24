import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { mkdir, mkdtemp, readFile, readdir, realpath, rename, rm, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { standIn } from './standin.ts';
import { tomlValue } from '../src/textedit.ts';
import { compareVersions } from '../src/values.ts';
import { INLINE_SKILLS_CONFIG } from '../src/pluginstatus.ts';
import { cachedCatalog, checkAccess, copySource, forgetRefusals, fromDirectory, gitFailure, gitPrefix, readRemotePlugin, refusedBy, repositoryKey, whyGitFailed, install, installState, parseCatalog, readCatalog, registeredMarketplaces, sameSource, setSkill, uninstall, update, type PluginContext } from '../src/plugins.ts';

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
  await put(join(full, 'hooks/hooks.json'), JSON.stringify({ hooks: { SessionStart: [{ hooks: [{ type: 'command', command: 'echo started' }] }] } }));
  await put(join(full, '.mcp.json'), JSON.stringify({ mcpServers: { local: { command: '${CLAUDE_PLUGIN_ROOT}/server' } } }));
  await put(join(root, 'plugins/marker/.claude-plugin/plugin.json'), JSON.stringify({ name: 'marker', version: '0.3.0' }));
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
    assert.deepEqual(catalog.plugins.find(plugin => plugin.name === 'full')!.components, { skills: 2, commands: 1, agents: 1, hooks: true, hooksIn: ['claude-cli', 'copilot-cli', 'codex-cli'], startHooksIn: ['claude-cli', 'copilot-cli', 'codex-cli'], promptHooksIn: [], mcp: 1, mcpRootVariable: true, bin: false, sessionTextHooks: ['claude-cli', 'copilot-cli', 'codex-cli'], skillNames: ['one', 'two'] });
    assert.equal(catalog.plugins.find(plugin => plugin.name === 'escape')!.components, undefined, 'a path outside is not read');
    // A version the entry doesn't give comes from the plugin's own plugin.json, whether or not its files are counted.
    for (const counts of [true, false]) assert.equal((await parseCatalog(root, root, 'folder', { counts })).plugins.find(plugin => plugin.name === 'marker')!.version, '0.3.0');
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

test('A Codex marketplace (.agents/plugins/marketplace.json, local sources) is read as Codex reads it, and only Codex is offered its plugins', async () => {
  const box = await sandbox();
  try {
    const root = join(box.base, 'openai-bundled');
    await put(join(root, '.agents/plugins/marketplace.json'), JSON.stringify({ name: 'openai-bundled', plugins: [{ name: 'latex', source: { source: 'local', path: './plugins/latex' }, category: 'Education' }] }));
    await put(join(root, 'plugins/latex/.codex-plugin/plugin.json'), JSON.stringify({ name: 'latex', version: '0.2.8' }));
    await put(join(root, 'plugins/latex/skills/latex-compile/SKILL.md'), '---\nname: latex-compile\ndescription: Compile.\n---\nB\n');
    const catalog = await parseCatalog(root, root, 'folder');
    assert.equal(catalog.problem, undefined);
    const [latex] = catalog.plugins;
    assert.equal(latex!.folder, join(root, 'plugins/latex'));
    assert.equal(latex!.version, '0.2.8');
    assert.equal(latex!.components?.skills, 1);
    assert.match(catalog.codexOnly ?? '', /Only Codex/);
    const report = await install(box.context, catalog, 'latex', 'claude-cli');
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
    // A port or folder in the address that looks like an HTTP status is not one.
    [128, 'remote: Repository not found.\nfatal: repository \'http://127.0.0.1:34015/missing.git/\' not found', 'no-access', /No access/],
    [128, 'fatal: \'/tmp/ck-repo-a403bc/config.git\' does not appear to be a git repository', 'no-access', /No access/],
    [128, 'fatal: unable to access \'https://x/a.git/\': The requested URL returned error: 403', 'sign-in', /Sign-in needed/],
    [1, 'something new happened', 'unclassified', /^something new happened$/],
  ];
  for (const [code, output, state, words] of samples) {
    const failure = gitFailure(code, output);
    assert.deepEqual([failure.state, words.test(failure.message)], [state, true], `${output}: ${failure.message}`);
    assert.equal(whyGitFailed(code, output), failure.message, 'a clone and an access check word one failure the same way');
  }
});

test('Git command prefix keeps macOS and Linux unchanged and adds byte-exact and long-path settings on Windows', () => {
  // Literal list read from `git show origin/next:src/plugins.ts` (`plugins.ts` `git`).
  const nextPrefix = ['-c', 'core.hooksPath=/dev/null'];
  assert.deepEqual(gitPrefix('darwin'), nextPrefix);
  assert.deepEqual(gitPrefix('linux'), nextPrefix);
  assert.deepEqual(gitPrefix('win32'), [
    ...nextPrefix,
    '-c', 'core.autocrlf=false',
    '-c', 'core.eol=lf',
    '-c', 'core.longpaths=true',
  ]);
  assert.deepEqual(gitPrefix(), gitPrefix(process.platform));
});

test('Clones and pinned checkouts keep exact LF bytes (even under text=auto) and paths past 260 characters', async () => {
  const box = await sandbox();
  try {
    const repo = join(box.base, 'repo');
    const deep = join('a'.repeat(50), 'b'.repeat(50), 'c'.repeat(50), 'd'.repeat(50), 'e'.repeat(50), 'SKILL.md');
    const v1 = { plain: 'line one\nline two\n', auto: 'alpha\nbeta\n', deep: '---\nname: deep\n---\nBody.\n' };
    const v2 = { plain: 'line one\nline two\nline three\n', auto: 'alpha\nbeta\ngamma\n', deep: v1.deep };
    const git = (args: string[]) => execFileSync('git', ['-C', repo, '-c', 'core.autocrlf=false', '-c', 'core.longpaths=true', '-c', 'user.email=t@t', '-c', 'user.name=t', '-c', 'commit.gpgsign=false', ...args], { encoding: 'utf8' }).trim();
    await mkdir(repo, { recursive: true });
    execFileSync('git', ['init', '-q', '-b', 'main', repo]);
    git(['config', 'uploadpack.allowReachableSHA1InWant', 'true']);
    await put(join(repo, '.gitattributes'), 'auto.md text=auto\n');
    await put(join(repo, 'plain.md'), v1.plain);
    await put(join(repo, 'auto.md'), v1.auto);
    await put(join(repo, deep), v1.deep);
    git(['add', '--all']);
    git(['commit', '-qm', 'v1']);
    const firstSha = git(['rev-parse', 'HEAD']);
    await put(join(repo, 'plain.md'), v2.plain);
    await put(join(repo, 'auto.md'), v2.auto);
    git(['add', '--all']);
    git(['commit', '-qm', 'v2']);

    const url = pathToFileURL(repo).href;
    const target = join(box.base, 'copied');
    assert.equal(await copySource(url, target), undefined);
    assert.ok(join(target, deep).length > 260, `expected >260 char path, got ${join(target, deep).length}`);
    assert.equal(await readFile(join(target, 'plain.md'), 'utf8'), v2.plain);
    assert.equal(await readFile(join(target, 'auto.md'), 'utf8'), v2.auto);
    assert.equal(await readFile(join(target, deep), 'utf8'), v2.deep);

    const pinned = await readRemotePlugin(box.context, { url, path: '.', sha: firstSha });
    assert.ok('folder' in pinned, JSON.stringify(pinned));
    assert.equal(await readFile(join(pinned.folder, 'plain.md'), 'utf8'), v1.plain);
    assert.equal(await readFile(join(pinned.folder, 'auto.md'), 'utf8'), v1.auto);
    assert.equal(await readFile(join(pinned.folder, deep), 'utf8'), v1.deep);
  } finally { await box.cleanup(); }
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
    // Claude Code's refusal is forgotten first, as the person's Refresh does: else it is said, and nothing is checked.
    forgetRefusals();
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
    // Its version is the one the tool records; Claude Code's "unknown" falls back to the copy's plugin.json.
    await put(join(box.home, '.claude/plugins/installed_plugins.json'), JSON.stringify({ version: 2, plugins: { 'p@m': [{ scope: 'user', installPath: cache, version: '1.0.0' }] } }));
    assert.partialDeepStrictEqual(await installState(box.context, 'claude-cli', 'm', 'p'), { state: 'installed', path: cache, version: '1.0.0' });
    await put(join(box.home, '.claude/plugins/installed_plugins.json'), JSON.stringify({ version: 2, plugins: { 'p@m': [{ scope: 'user', installPath: cache, version: 'unknown' }] } }));
    await put(join(cache, '.claude-plugin/plugin.json'), JSON.stringify({ name: 'p', version: '0.9.1' }));
    assert.equal((await installState(box.context, 'claude-cli', 'm', 'p') as { version?: string }).version, '0.9.1');
    // So does a commit hash, which Claude Code records for a plugin without a version.
    await put(join(box.home, '.claude/plugins/installed_plugins.json'), JSON.stringify({ version: 2, plugins: { 'p@m': [{ scope: 'user', installPath: cache, version: 'a1b2c3d4e5f6' }] } }));
    assert.equal((await installState(box.context, 'claude-cli', 'm', 'p') as { version?: string }).version, '0.9.1');
    // And hashes joined by "-", as a git-subdir plugin records its commit and the hash of its path.
    await put(join(box.home, '.claude/plugins/installed_plugins.json'), JSON.stringify({ version: 2, plugins: { 'p@m': [{ scope: 'user', installPath: cache, version: 'a1b2c3d4e5f6-9f8e7d6c' }] } }));
    assert.equal((await installState(box.context, 'claude-cli', 'm', 'p') as { version?: string }).version, '0.9.1');

    const copied = join(box.home, '.copilot/installed-plugins/m/p');
    await put(join(box.home, '.copilot/config.json'), `// User settings belong in settings.json.\n// This file is managed automatically.\n${JSON.stringify({ installedPlugins: [{ name: 'p', marketplace: 'm', version: '2.1.0', cache_path: copied, enabled: true }] })}`);
    assert.equal((await installState(box.context, 'copilot-cli', 'm', 'p')).state, 'not-known');
    await put(join(copied, 'skills/s/SKILL.md'), 'x');
    assert.partialDeepStrictEqual(await installState(box.context, 'copilot-cli', 'm', 'p'), { state: 'installed', path: copied, version: '2.1.0' });

    const live = join(box.base, 'live-market');
    await marketplace(live);
    await put(join(box.home, '.copilot/settings.json'), JSON.stringify({ extraKnownMarketplaces: { 'ck-test-market': { source: { source: 'directory', path: live } } }, enabledPlugins: { 'marker@ck-test-market': true } }));
    const liveState = await installState(box.context, 'copilot-cli', 'ck-test-market', 'marker');
    assert.ok(liveState.state === 'installed' && liveState.live, JSON.stringify(liveState));
    // Copilot CLI's uninstall of a folder marketplace's plugin only sets its record to false: that is not installed.
    await put(join(box.home, '.copilot/settings.json'), JSON.stringify({ extraKnownMarketplaces: { 'ck-test-market': { source: { source: 'directory', path: live } } }, enabledPlugins: { 'marker@ck-test-market': false } }));
    assert.equal((await installState(box.context, 'copilot-cli', 'ck-test-market', 'marker')).state, 'not-installed');
    // Claude Code records a cache copy of a folder marketplace's plugin, and its version then, but loads the folder.
    await put(join(box.home, '.claude/plugins/known_marketplaces.json'), JSON.stringify({ 'ck-test-market': { source: { source: 'directory', path: live }, installLocation: live } }));
    await put(join(box.home, '.claude/plugins/installed_plugins.json'), JSON.stringify({ version: 2, plugins: { 'marker@ck-test-market': [{ scope: 'user', installPath: cache, version: '0.1.0' }] } }));
    assert.partialDeepStrictEqual(await installState(box.context, 'claude-cli', 'ck-test-market', 'marker'), { state: 'installed', path: join(live, 'plugins/marker'), live: true, version: '0.3.0' });

    await put(join(box.home, '.codex/config.toml'), '[plugins."p@m"]\nenabled = true\n');
    assert.equal((await installState(box.context, 'codex-cli', 'm', 'p')).state, 'not-known');
    await put(join(box.home, '.codex/plugins/cache/m/p/1.0.0/skills/s/SKILL.md'), 'x');
    assert.partialDeepStrictEqual(await installState(box.context, 'codex-cli', 'm', 'p'), { state: 'installed', path: join(box.home, '.codex/plugins/cache/m/p/1.0.0'), version: '1.0.0' });
  } finally { await box.cleanup(); }
});

test('Codex loads the copy it chooses from its cache: the highest version, or "local", and a commit-named copy has its manifest\'s version', async () => {
  const box = await sandbox();
  try {
    const version = async (plugin = 'p') => (await installState(box.context, 'codex-cli', 'm', plugin) as { version?: string }).version;
    await put(join(box.home, '.codex/config.toml'), '[plugins."p@m"]\nenabled = true\n\n[plugins."h@m"]\nenabled = true\n');
    await put(join(box.home, '.codex/plugins/cache/m/p/1.0.0/skills/s/SKILL.md'), 'x');
    // With several copies kept, Codex loads the highest version (numbers compared as numbers), or "local" when there is one.
    await put(join(box.home, '.codex/plugins/cache/m/p/1.10.0/skills/s/SKILL.md'), 'x');
    await put(join(box.home, '.codex/plugins/cache/m/p/1.9.0/skills/s/SKILL.md'), 'x');
    assert.equal(await version(), '1.10.0');
    // A release ranks above its own pre-release, as semantic versions do.
    await put(join(box.home, '.codex/plugins/cache/m/p/1.10.0-rc.1/skills/s/SKILL.md'), 'x');
    assert.equal(await version(), '1.10.0');
    // Codex reads "v1.9.0" as no semantic version, so plain text orders it, and it sorts above "1.10.0".
    await put(join(box.home, '.codex/plugins/cache/m/p/v1.9.0/skills/s/SKILL.md'), 'x');
    assert.equal(await version(), 'v1.9.0');
    await put(join(box.home, '.codex/plugins/cache/m/p/local/.codex-plugin/plugin.json'), JSON.stringify({ version: '2.0.0-dev' }));
    assert.partialDeepStrictEqual(await installState(box.context, 'codex-cli', 'm', 'p'), { state: 'installed', path: join(box.home, '.codex/plugins/cache/m/p/local'), version: '2.0.0-dev' });
    // A curated plugin's folder is named for a commit, not a version: its manifest gives the version.
    await put(join(box.home, '.codex/plugins/cache/m/h/77c10e110b37/.codex-plugin/plugin.json'), JSON.stringify({ version: '0.2.0' }));
    assert.equal(await version('h'), '0.2.0');
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

test('A marketplace a tool’s own add refused is not tried there again: later installs are held with its words, until Refresh or a new version of the tool', { skip: noPosix }, async () => {
  const box = await sandbox();
  try {
    const root = join(box.base, 'market'), bin = join(box.base, 'bin'), copilot = join(bin, 'copilot'), log = join(box.base, 'calls.txt');
    await marketplace(root);
    await mkdir(bin, { recursive: true });
    // Copilot CLI 1.0.109 refuses the official marketplace's file as invalid.
    const copilotAt = (version: string) => writeFile(copilot, `#!/bin/sh\n[ "$1" = "--version" ] && echo "GitHub Copilot CLI ${version}." && exit 0\necho "$*" >> '${log}'\necho 'Invalid marketplace.json: plugins.302.source' >&2\nexit 1\n`, { mode: 0o755 });
    await copilotAt('1.0.109');
    const context = { ...box.context, binaries: { 'copilot-cli': copilot } }, catalog = await parseCatalog(root, root, 'folder');
    const calls = async () => (await readFile(log, 'utf8').catch(() => '')).trim().split('\n').filter(Boolean).length;
    assert.deepEqual([(await install(context, catalog, 'marker', 'copilot-cli')).outcome, await calls()], ['failed', 1]);
    const again = await install(context, catalog, 'marker', 'copilot-cli');
    const said = 'Copilot CLI refused this marketplace: “Invalid marketplace.json: plugins.302.source” It isn’t tried there again until Refresh, or a new version of Copilot CLI.';
    assert.deepEqual([again.outcome, again.message, again.runs, await calls()], ['held', `${said} Nothing was added to Copilot CLI.`, [], 1], 'nothing ran');
    assert.equal(await refusedBy(context, 'copilot-cli', root), said, 'the page says it where Copilot CLI’s state is said');
    // A new version is asked again; the person's Refresh forgets every refusal.
    await copilotAt('1.0.1100');
    assert.deepEqual([(await install(context, catalog, 'marker', 'copilot-cli')).outcome, await calls()], ['failed', 2]);
    forgetRefusals();
    assert.deepEqual([await refusedBy(context, 'copilot-cli', root), (await install(context, catalog, 'marker', 'copilot-cli')).outcome, await calls()], [undefined, 'failed', 3]);
  } finally { forgetRefusals(); await box.cleanup(); }
});

test('Only the tool’s own answer about the marketplace is a refusal: an add that failed for want of a network is said as it was, and tried again at the next click', { skip: noPosix }, async () => {
  const box = await sandbox();
  try {
    const root = join(box.base, 'market'), bin = join(box.base, 'bin'), copilot = join(bin, 'copilot'), log = join(box.base, 'calls.txt');
    await marketplace(root);
    await mkdir(bin, { recursive: true });
    await writeFile(copilot, `#!/bin/sh\n[ "$1" = "--version" ] && echo "GitHub Copilot CLI 1.0.109." && exit 0\necho "$*" >> '${log}'\necho 'fatal: unable to access: Could not resolve host: github.com' >&2\nexit 128\n`, { mode: 0o755 });
    const context = { ...box.context, binaries: { 'copilot-cli': copilot } }, catalog = await parseCatalog(root, root, 'folder');
    const first = await install(context, catalog, 'marker', 'copilot-cli');
    assert.deepEqual([first.outcome, first.message, await refusedBy(context, 'copilot-cli', root)], ['failed', 'Could not add the marketplace. fatal: unable to access: Could not resolve host: github.com', undefined]);
    await install(context, catalog, 'marker', 'copilot-cli');
    assert.equal((await readFile(log, 'utf8')).trim().split('\n').length, 2, 'tried again');
  } finally { forgetRefusals(); await box.cleanup(); }
});

test('Codex is told the chosen home outright, since on Windows it finds its own from the system', { skip: noPosix }, async () => {
  const box = await sandbox();
  const saved = process.env.CODEX_HOME;
  try {
    const root = join(box.base, 'market');
    await marketplace(root);
    const codex = join(box.base, 'bin/codex');
    await put(codex, '#!/bin/sh\necho "$CODEX_HOME" >> "$HOME/calls.txt"\nexit 3\n');
    execFileSync('chmod', ['755', codex]);
    process.env.CODEX_HOME = join(box.base, 'elsewhere');
    await install({ ...box.context, binaries: { 'codex-cli': codex } }, await parseCatalog(root, root, 'folder'), 'marker', 'codex-cli');
    assert.equal((await readFile(join(box.home, 'calls.txt'), 'utf8')).split('\n')[0], join(box.home, '.codex'));
  } finally { if (saved === undefined) delete process.env.CODEX_HOME; else process.env.CODEX_HOME = saved; await box.cleanup(); }
});

test('A plugin command for a home that is not this computer’s own is given, on Windows, that home’s own variables; this computer’s own keeps the person’s', async () => {
  const box = await sandbox();
  const names = ['USERPROFILE', 'HOMEDRIVE', 'HOMEPATH', 'APPDATA', 'LOCALAPPDATA', 'CODEX_HOME'];
  try {
    const root = join(box.base, 'market');
    await marketplace(root);
    const codex = await standIn(join(box.base, 'bin/codex'), `#!/bin/sh\necho "${names.map(name => `$${name}`).join('|')}" >> "$HOME/calls.txt"\nexit 3\n`,
      `require("fs").appendFileSync(process.env.HOME + "/calls.txt", ${JSON.stringify(names)}.map(name => process.env[name] ?? "").join("|") + "\\n"); process.exitCode = 3;`);
    /** What the first command of an install was given, run for the box's home as this computer's own (`actual`) or not. */
    const given = async (actual: boolean) => {
      await writeFile(join(box.home, 'calls.txt'), '');
      await install({ ...box.context, actual, binaries: { 'codex-cli': codex } }, await parseCatalog(root, root, 'folder'), 'marker', 'codex-cli');
      return Object.fromEntries((await readFile(join(box.home, 'calls.txt'), 'utf8')).split('\n')[0].split('|').map((value, at) => [names[at], value]));
    };
    // USERPROFILE and CODEX_HOME were the chosen home's for every home before; the person's own values otherwise.
    const own = { ...Object.fromEntries(names.map(name => [name, process.env[name] ?? ''])), USERPROFILE: box.home, CODEX_HOME: join(box.home, '.codex') };
    assert.deepEqual(await given(false), process.platform === 'win32' ? { USERPROFILE: box.home, HOMEDRIVE: box.home.slice(0, 2), HOMEPATH: box.home.slice(2),
      APPDATA: join(box.home, 'AppData', 'Roaming'), LOCALAPPDATA: join(box.home, 'AppData', 'Local'), CODEX_HOME: join(box.home, '.codex') } : own);
    assert.deepEqual(await given(true), own);
  } finally { await box.cleanup(); }
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

/** Claude Code's records of a plugin it installed from the Anthropic Directory (as 2.1.322 writes them), with its files. */
async function directoryInstall(home: string, id: string, key: string, { onRecord = true } = {}) {
  const copy = join(home, '.claude/plugins/cache/anthropic-plugin-directory/incident-io/1.20261014.705-6af50e2e23e9');
  await put(join(copy, '.claude-plugin/plugin.json'), JSON.stringify({ name: 'incident-io', version: '1.20261014.705' }));
  await put(join(copy, 'skills/incidents/SKILL.md'), '---\nname: incidents\ndescription: Incidents.\n---\n');
  await put(join(home, '.claude/plugins/installed_plugins.json'), JSON.stringify({ version: 2, plugins: { [id]: [{ scope: 'user', installPath: copy, version: '1.20261014.705-6af50e2e23e9',
    gitCommitSha: '6af50e2e23e9c782b95a456aab5a053550fba3c9', ...(onRecord ? { directoryRepositoryKey: key } : {}) }] } }));
  await put(join(home, '.claude/plugins/plugin-directory-bindings.json'), JSON.stringify({ schemaVersion: 1, bindings: { [id]: { repositoryKey: key } } }));
  await put(join(home, '.claude/settings.json'), JSON.stringify({ enabledPlugins: { [id]: true } }));
  return copy;
}

test('A repository key is spelled as Claude Code keys the Anthropic Directory, however the address was written', () => {
  assert.equal(repositoryKey('https://github.com/incident-io/skills.git', 'plugins/incident-io'), 'github.com/incident-io/skills#plugins/incident-io');
  assert.equal(repositoryKey('https://github.com/SalesforceAIResearch/agentforce-adlc.git'), 'github.com/salesforceairesearch/agentforce-adlc#');
  assert.equal(repositoryKey('git@gitlab.com:team/tools/plugins.git', './plugins/x/'), 'gitlab.com/team/tools/plugins#plugins/x');
  assert.equal(repositoryKey('ssh://git@github.com/owner/repo/', 'a\\b'), 'github.com/owner/repo#a/b');
  assert.equal(repositoryKey('/Users/me/market', 'plugins/x'), undefined);
  // Only the repository is lowercase: the directory's own catalog keeps a folder's case ("…#HubSpot-Sales").
  assert.equal(repositoryKey('https://github.com/HubSpot/hubspot-mcp-plugins', 'HubSpot-Sales'), 'github.com/hubspot/hubspot-mcp-plugins#HubSpot-Sales');
});

test('A plugin Claude Code has from the Anthropic Directory is the marketplace’s same plugin, installed: Install runs nothing', { skip: noPosix }, async () => {
  const box = await sandbox();
  try {
    const root = join(box.base, 'market');
    await marketplace(root, [
      { name: 'incident-io', source: { source: 'git-subdir', url: 'https://github.com/Incident-IO/skills.git', path: 'plugins/incident-io', sha: '00f7d1dc80892deb1656f1cf577dd073a4a2de10' } },
      { name: 'elsewhere', source: { source: 'git-subdir', url: 'https://github.com/incident-io/skills.git', path: 'plugins/other' } },
    ]);
    // Under its directory name ("incident.io"), not the marketplace's, with the key on its record.
    const copy = await directoryInstall(box.home, 'incident.io@anthropic-plugin-directory', 'github.com/incident-io/skills#plugins/incident-io');
    const bin = join(box.base, 'bin');
    await mkdir(bin, { recursive: true });
    await writeFile(join(bin, 'claude'), `#!/bin/sh\necho "$@" >> "${join(box.base, 'ran')}"\n`, { mode: 0o755 });
    const context = { ...box.context, binaries: { 'claude-cli': join(bin, 'claude') } as PluginContext['binaries'] };
    const catalog = await parseCatalog(root, root, 'folder');
    const item = (name: string) => catalog.plugins.find(plugin => plugin.name === name)!;
    assert.deepEqual(await fromDirectory(context, catalog, item('incident-io')), { state: 'installed', path: copy, version: '1.20261014.705', directory: 'incident.io@anthropic-plugin-directory' });
    assert.equal(await fromDirectory(context, catalog, item('elsewhere')), undefined, 'another folder of the same repository is another plugin');
    assert.equal(await fromDirectory(context, catalog, item('full')), undefined, 'a plugin kept in a folder marketplace has no repository key');
    // Keys compare ignoring case: the record may spell the folder otherwise than the marketplace does.
    await directoryInstall(box.home, 'incident.io@anthropic-plugin-directory', 'github.com/incident-io/skills#Plugins/Incident-IO');
    assert.equal((await fromDirectory({ ...context, reads: new Map() }, catalog, item('incident-io')))?.state, 'installed');
    await directoryInstall(box.home, 'incident.io@anthropic-plugin-directory', 'github.com/incident-io/skills#plugins/incident-io');
    assert.deepEqual((await installState(context, 'claude-cli', 'ck-test-market', 'incident-io')).state, 'not-installed', 'not from this marketplace');
    const report = await install(context, catalog, 'incident-io', 'claude-cli');
    assert.deepEqual([report.outcome, report.changed, report.runs.length], ['installed', undefined, 0], report.message);
    assert.match(report.message, /from the Anthropic Directory/);
    assert.equal(await readFile(join(box.base, 'ran'), 'utf8').catch(() => ''), '', 'nothing ran: no marketplace add, no install');
  } finally { await box.cleanup(); }
});

test('A directory install’s key is also read from plugin-directory-bindings.json, and found for a plugin kept in a Git marketplace', async () => {
  const box = await sandbox();
  try {
    const root = join(box.base, 'clone');
    await put(join(root, '.claude-plugin/marketplace.json'), JSON.stringify({ name: 'claude-plugins-official', plugins: [{ name: 'frontend-design', source: './plugins/frontend-design' }] }));
    await put(join(root, 'plugins/frontend-design/.claude-plugin/plugin.json'), JSON.stringify({ name: 'frontend-design' }));
    await directoryInstall(box.home, 'frontend-design@anthropic-plugin-directory', 'github.com/anthropics/claude-plugins-official#plugins/frontend-design', { onRecord: false });
    const catalog = await parseCatalog(root, 'anthropics/claude-plugins-official', 'git');
    const found = await fromDirectory(box.context, catalog, catalog.plugins[0]!);
    assert.deepEqual([found?.state, found?.state === 'installed' && found.directory], ['installed', 'frontend-design@anthropic-plugin-directory']);
  } finally { await box.cleanup(); }
});

test('A directory install whose files are gone is held, not offered for Install: Claude Code would refuse the marketplace’s copy', { skip: noPosix }, async () => {
  const box = await sandbox();
  try {
    const root = join(box.base, 'market');
    await marketplace(root, [{ name: 'incident-io', source: { source: 'git-subdir', url: 'https://github.com/incident-io/skills.git', path: 'plugins/incident-io' } }]);
    const copy = await directoryInstall(box.home, 'incident.io@anthropic-plugin-directory', 'github.com/incident-io/skills#plugins/incident-io');
    await rm(copy, { recursive: true });
    const bin = join(box.base, 'bin');
    await mkdir(bin, { recursive: true });
    await writeFile(join(bin, 'claude'), `#!/bin/sh\necho "$@" >> "${join(box.base, 'ran')}"\n`, { mode: 0o755 });
    const context = { ...box.context, binaries: { 'claude-cli': join(bin, 'claude') } as PluginContext['binaries'] };
    const catalog = await parseCatalog(root, root, 'folder');
    const state = await fromDirectory(context, catalog, catalog.plugins.find(plugin => plugin.name === 'incident-io')!);
    assert.equal(state?.state, 'held');
    assert.match(state?.state === 'held' ? state.reason : '', /incident\.io@anthropic-plugin-directory.*Reinstall it in Claude Code/);
    assert.equal((await install(context, catalog, 'incident-io', 'claude-cli')).outcome, 'held');
    assert.equal(await readFile(join(box.base, 'ran'), 'utf8').catch(() => ''), '', 'nothing ran');
  } finally { await box.cleanup(); }
});

test('A tool that says it already has the plugin from elsewhere is not told its copy of the marketplace may be old', { skip: noPosix }, async () => {
  const box = await sandbox();
  try {
    const root = join(box.base, 'market');
    await marketplace(root);
    await put(join(box.home, '.claude/plugins/known_marketplaces.json'), JSON.stringify({ 'ck-test-market': { source: { source: 'directory', path: root }, installLocation: root } }));
    const bin = join(box.base, 'bin');
    await mkdir(bin, { recursive: true });
    await writeFile(join(bin, 'claude'), '#!/bin/sh\necho \'✔ "marker" is already installed from Somewhere (the same plugin). Nothing to install.\'\n', { mode: 0o755 });
    const context = { ...box.context, binaries: { 'claude-cli': join(bin, 'claude') } as PluginContext['binaries'] };
    const report = await install(context, await parseCatalog(root, root, 'folder'), 'marker', 'claude-cli');
    assert.equal(report.outcome, 'failed');
    assert.match(report.message, /already installed from Somewhere/);
    assert.doesNotMatch(report.message, /may be older/);
  } finally { await box.cleanup(); }
});

test('Update refreshes the tool’s copy of a Git marketplace, then takes the new version, read back from the tool’s own record', { skip: noPosix }, async () => {
  const box = await sandbox();
  try {
    const root = join(box.base, 'market');
    await marketplace(root);
    const url = 'https://example.test/team/market.git';
    // Codex has full 1.0.0 from that marketplace. Its stand-in moves the copy to 2.0.0 only once its marketplace is upgraded.
    await put(join(box.home, '.codex/plugins/cache/ck-test-market/full/1.0.0/skills/one/SKILL.md'), '---\nname: one\n---\n');
    await put(join(box.home, '.codex/config.toml'), `[marketplaces.ck-test-market]\nsource = "${url}"\n\n[plugins."full@ck-test-market"]\nenabled = true\n`);
    const bin = join(box.base, 'bin');
    await mkdir(bin, { recursive: true });
    await writeFile(join(bin, 'codex'), `#!/bin/sh
echo "$*" >> "$HOME/calls.txt"
case "$3" in
  upgrade) touch "$HOME/upgraded" ;;
  full@ck-test-market) [ -f "$HOME/upgraded" ] && mkdir -p "$HOME/.codex/plugins/cache/ck-test-market/full/2.0.0/skills/one" && cp "$HOME/.codex/plugins/cache/ck-test-market/full/1.0.0/skills/one/SKILL.md" "$HOME/.codex/plugins/cache/ck-test-market/full/2.0.0/skills/one/" ;;
esac
exit 0
`, { mode: 0o755 });
    const read = await parseCatalog(root, root, 'folder');
    const catalog = { ...read, kind: 'git' as const, source: url, plugins: read.plugins.map(plugin => (plugin.name === 'full' ? { ...plugin, version: '2.0.0' } : plugin)) };
    const context = { ...box.context, binaries: { 'codex-cli': join(bin, 'codex') } as PluginContext['binaries'] };
    const report = await update(context, catalog, 'full', 'codex-cli');
    assert.deepEqual([report.outcome, report.changed, report.version], ['updated', true, '2.0.0'], report.message);
    assert.deepEqual(report.runs.map(run => run.command), ['codex plugin marketplace upgrade ck-test-market', 'codex plugin add full@ck-test-market --json']);
    const again = await update(context, catalog, 'full', 'codex-cli');
    assert.deepEqual([again.outcome, again.changed, again.runs.length], ['updated', undefined, 0], 'up to date already runs nothing and changes nothing');
  } finally { await box.cleanup(); }
});

test('An update the tool says it ran but its record doesn’t show fails with what the tool said', { skip: noPosix }, async () => {
  const box = await sandbox();
  try {
    const root = join(box.base, 'market');
    await marketplace(root);
    const copy = join(box.home, '.claude/plugins/cache/ck-test-market/full/0.9.0');
    await put(join(copy, '.claude-plugin/plugin.json'), '{"name":"full","version":"0.9.0"}');
    await put(join(box.home, '.claude/plugins/installed_plugins.json'), JSON.stringify({ plugins: { 'full@ck-test-market': [{ scope: 'user', installPath: copy, version: '0.9.0' }] } }));
    const bin = join(box.base, 'bin');
    await mkdir(bin, { recursive: true });
    await writeFile(join(bin, 'claude'), '#!/bin/sh\necho "$*" >> "$HOME/calls.txt"\necho "ck-marker is already at the latest version (0.9.0)."\n', { mode: 0o755 });
    const context = { ...box.context, binaries: { 'claude-cli': join(bin, 'claude') } as PluginContext['binaries'] };
    // A folder marketplace has no copy of its own to refresh in the tool: only the update runs.
    const report = await update(context, await parseCatalog(root, root, 'folder'), 'full', 'claude-cli');
    assert.equal(report.outcome, 'failed');
    assert.match(report.message, /^Still 0\.9\.0 in Claude Code; the marketplace has 1\.0\.0\. .*already at the latest/);
    assert.equal(await readFile(join(box.home, 'calls.txt'), 'utf8'), 'plugin update full@ck-test-market --scope user\n');
  } finally { await box.cleanup(); }
});

test('A copy that differs at the same version is updated, and where the tool keeps its copy, uninstalled and installed again, then compared', { skip: noPosix }, async () => {
  const box = await sandbox();
  try {
    const root = join(box.base, 'market');
    await marketplace(root);
    const copy = join(box.home, '.claude/plugins/cache/ck-test-market/full/1.0.0');
    const record = join(box.home, '.claude/plugins/installed_plugins.json');
    await put(join(copy, '.claude-plugin/plugin.json'), '{"name":"full","version":"1.0.0"}');
    await put(join(copy, 'skills/one/SKILL.md'), '---\nname: one\ndescription: One.\n---\nA\n');
    const recorded = JSON.stringify({ plugins: { 'full@ck-test-market': [{ scope: 'user', installPath: copy, version: '1.0.0' }] } });
    await put(record, recorded);
    // Turned off by its person in Claude Code, whose install turns a plugin on: it is turned off again after the reinstall.
    await put(join(box.home, '.claude/settings.json'), '{"enabledPlugins":{"full@ck-test-market":false}}');
    // Claude Code's stand-in: its update says it is at the latest; an install copies the marketplace's files again.
    const bin = join(box.base, 'bin');
    await mkdir(bin, { recursive: true });
    await writeFile(join(bin, 'claude'), `#!/bin/sh
echo "$*" >> "$HOME/calls.txt"
case "$2" in
  update) echo "full is already at the latest version (1.0.0)." ;;
  uninstall) echo '{"plugins":{}}' > "${record}" ;;
  install) cp "${root}/plugins/full/skills/one/SKILL.md" "${copy}/skills/one/SKILL.md"; echo '${recorded}' > "${record}"; echo '{"enabledPlugins":{"full@ck-test-market":true}}' > "$HOME/.claude/settings.json" ;;
  disable) echo '{"enabledPlugins":{"full@ck-test-market":false}}' > "$HOME/.claude/settings.json" ;;
esac
`, { mode: 0o755 });
    const context = { ...box.context, binaries: { 'claude-cli': join(bin, 'claude') } as PluginContext['binaries'] };
    const catalog = await parseCatalog(root, root, 'folder');
    const differs = async () => (await readFile(join(copy, 'skills/one/SKILL.md'), 'utf8')) !== (await readFile(join(root, 'plugins/full/skills/one/SKILL.md'), 'utf8'));
    const report = await update(context, catalog, 'full', 'claude-cli', differs);
    assert.deepEqual([report.outcome, report.changed, report.byContent, report.version], ['updated', true, 'reinstall', '1.0.0'], report.message);
    assert.equal(report.message, 'Reinstalled from the marketplace’s copy of 1.0.0: Claude Code’s own update kept the copy it had. It is still off in Claude Code.');
    assert.deepEqual(report.runs.map(run => run.command), ['claude plugin update full@ck-test-market --scope user', 'claude plugin uninstall full@ck-test-market --scope user', 'claude plugin install full@ck-test-market --scope user', 'claude plugin disable full@ck-test-market --scope user']);
    assert.equal(JSON.parse(await readFile(join(box.home, '.claude/settings.json'), 'utf8')).enabledPlugins['full@ck-test-market'], false);
    const again = await update(context, catalog, 'full', 'claude-cli', differs);
    assert.deepEqual([again.outcome, again.changed, again.runs.length], ['updated', undefined, 0], 'the same copy runs nothing');
  } finally { await box.cleanup(); }
});

test('An update nobody is watching never uninstalls to reinstall: a copy the tool’s own update kept is left, and says so', { skip: noPosix }, async () => {
  const box = await sandbox();
  try {
    const root = join(box.base, 'market');
    await marketplace(root);
    const copy = join(box.home, '.claude/plugins/cache/ck-test-market/full/1.0.0');
    await put(join(copy, '.claude-plugin/plugin.json'), '{"name":"full","version":"1.0.0"}');
    await put(join(copy, 'skills/one/SKILL.md'), '---\nname: one\ndescription: One.\n---\nA\n');
    await put(join(box.home, '.claude/plugins/installed_plugins.json'), JSON.stringify({ plugins: { 'full@ck-test-market': [{ scope: 'user', installPath: copy, version: '1.0.0' }] } }));
    const bin = join(box.base, 'bin');
    await mkdir(bin, { recursive: true });
    await writeFile(join(bin, 'claude'), '#!/bin/sh\necho "$*" >> "$HOME/calls.txt"\necho "full is already at the latest version (1.0.0)."\n', { mode: 0o755 });
    const context = { ...box.context, binaries: { 'claude-cli': join(bin, 'claude') } as PluginContext['binaries'] };
    const report = await update(context, await parseCatalog(root, root, 'folder'), 'full', 'claude-cli', async () => true, { reinstall: false });
    assert.deepEqual([report.outcome, report.changed], ['failed', undefined]);
    assert.match(report.message, /^Claude Code’s own update kept the copy it had, which still differs from the marketplace’s\. Update it on its page to reinstall it\./);
    assert.equal(await readFile(join(box.home, 'calls.txt'), 'utf8'), 'plugin update full@ck-test-market --scope user\n', 'only its own update ran');
    assert.equal((await installState(context, 'claude-cli', 'ck-test-market', 'full')).state, 'installed');
  } finally { await box.cleanup(); }
});

test('A plugin turned off in a tool is still off after its update, turned off again where the tool’s own update turned it on', { skip: noPosix }, async () => {
  const box = await sandbox();
  try {
    const root = join(box.base, 'market');
    await marketplace(root);
    // Codex has full 1.0.0, turned off. Its stand-in's `plugin add` puts 2.0.0 in and writes the plugin's table again, on.
    await put(join(box.home, '.codex/plugins/cache/ck-test-market/full/1.0.0/skills/one/SKILL.md'), '---\nname: one\n---\n');
    const config = join(box.home, '.codex/config.toml');
    await put(config, 'model = "x"\n\n[plugins."full@ck-test-market"]\nenabled = false # off for now\n\n[plugins."other@ck-test-market"]\nenabled = true\n');
    await put(join(box.base, 'on.toml'), 'model = "x"\n\n[plugins."full@ck-test-market"]\nenabled = true\n\n[plugins."other@ck-test-market"]\nenabled = true\n');
    const bin = join(box.base, 'bin');
    await mkdir(bin, { recursive: true });
    await writeFile(join(bin, 'codex'), `#!/bin/sh
mkdir -p "$HOME/.codex/plugins/cache/ck-test-market/full/2.0.0/skills/one" && cp "$HOME/.codex/plugins/cache/ck-test-market/full/1.0.0/skills/one/SKILL.md" "$HOME/.codex/plugins/cache/ck-test-market/full/2.0.0/skills/one/"
cp "${join(box.base, 'on.toml')}" "$HOME/.codex/config.toml"
`, { mode: 0o755 });
    const read = await parseCatalog(root, root, 'folder');
    const catalog = { ...read, plugins: read.plugins.map(plugin => (plugin.name === 'full' ? { ...plugin, version: '2.0.0' } : plugin)) };
    const context = { ...box.context, binaries: { 'codex-cli': join(bin, 'codex') } as PluginContext['binaries'] };
    const report = await update(context, catalog, 'full', 'codex-cli');
    assert.deepEqual([report.outcome, report.changed, report.version, report.notes], ['updated', true, '2.0.0', undefined], report.message);
    assert.equal(report.message, 'Updated to 2.0.0. It is still off in Codex.');
    assert.equal(await readFile(config, 'utf8'), 'model = "x"\n\n[plugins."full@ck-test-market"]\nenabled = false\n\n[plugins."other@ck-test-market"]\nenabled = true\n', 'only its own switch changed');
    assert.deepEqual(report.runs.map(run => run.command), ['codex plugin add full@ck-test-market --json', 'config.toml [plugins."full@ck-test-market"] enabled = false']);
  } finally { await box.cleanup(); }
});

test('A Codex update that drops a plugin’s server switch (its own uninstall takes the table out) turns that server off again', { skip: noPosix }, async () => {
  const box = await sandbox();
  try {
    const root = join(box.base, 'market');
    await marketplace(root);
    // Codex has full 1.0.0 with the server `issues` turned off. Its stand-in's `plugin add` puts 2.0.0 in and writes
    // config.toml without the server's table, as a reinstall does.
    for (const version of ['1.0.0', 'next']) {
      const copy = join(box.home, '.codex/plugins/cache/ck-test-market/full', version);
      await put(join(copy, '.codex-plugin/plugin.json'), JSON.stringify({ name: 'full', mcpServers: './.mcp.json' }));
      await put(join(copy, '.mcp.json'), JSON.stringify({ mcpServers: { issues: { command: 'npx' }, wiki: { command: 'npx' } } }));
    }
    await rename(join(box.home, '.codex/plugins/cache/ck-test-market/full/next'), join(box.base, 'next'));
    const config = join(box.home, '.codex/config.toml');
    const plain = 'model = "x"\n\n[plugins."full@ck-test-market"]\nenabled = true\n';
    const off = '\n[plugins."full@ck-test-market".mcp_servers.issues]\nenabled = false\n';
    await put(config, plain + off);
    await put(join(box.base, 'plain.toml'), plain);
    const bin = join(box.base, 'bin');
    await mkdir(bin, { recursive: true });
    await writeFile(join(bin, 'codex'), `#!/bin/sh
cp -R "${join(box.base, 'next')}" "$HOME/.codex/plugins/cache/ck-test-market/full/2.0.0"
cp "${join(box.base, 'plain.toml')}" "$HOME/.codex/config.toml"
`, { mode: 0o755 });
    const read = await parseCatalog(root, root, 'folder');
    const catalog = { ...read, plugins: read.plugins.map(plugin => (plugin.name === 'full' ? { ...plugin, version: '2.0.0' } : plugin)) };
    const context = { ...box.context, binaries: { 'codex-cli': join(bin, 'codex') } as PluginContext['binaries'] };
    const report = await update(context, catalog, 'full', 'codex-cli');
    assert.deepEqual([report.outcome, report.version], ['updated', '2.0.0'], report.message);
    assert.equal(await readFile(config, 'utf8'), plain + off, 'the server is off again, and nothing else changed');
    assert.equal(report.runs.length, 2, 'the update, then the switch put back');
  } finally { await box.cleanup(); }
});

test('A tool whose update turns a plugin on, and whose switch then doesn’t hold, is said in the report', { skip: noPosix }, async () => {
  const box = await sandbox();
  try {
    const root = join(box.base, 'market');
    await marketplace(root);
    const copy = (version: string) => join(box.home, '.claude/plugins/cache/ck-test-market/full', version);
    await put(join(copy('0.9.0'), '.claude-plugin/plugin.json'), '{"name":"full","version":"0.9.0"}');
    await put(join(copy('1.0.0'), '.claude-plugin/plugin.json'), '{"name":"full","version":"1.0.0"}');
    const record = join(box.home, '.claude/plugins/installed_plugins.json');
    await put(record, JSON.stringify({ plugins: { 'full@ck-test-market': [{ scope: 'user', installPath: copy('0.9.0'), version: '0.9.0' }] } }));
    await put(join(box.home, '.claude/settings.json'), '{"enabledPlugins":{"full@ck-test-market":false}}');
    const bin = join(box.base, 'bin');
    await mkdir(bin, { recursive: true });
    // Its update moves the record on and turns the plugin on; its disable refuses.
    await writeFile(join(bin, 'claude'), `#!/bin/sh
case "$2" in
  update) echo '${JSON.stringify({ plugins: { 'full@ck-test-market': [{ scope: 'user', installPath: copy('1.0.0'), version: '1.0.0' }] } })}' > "${record}"; echo '{"enabledPlugins":{"full@ck-test-market":true}}' > "$HOME/.claude/settings.json" ;;
  disable) echo "Plugin could not be disabled."; exit 1 ;;
esac
`, { mode: 0o755 });
    const context = { ...box.context, binaries: { 'claude-cli': join(bin, 'claude') } as PluginContext['binaries'] };
    const report = await update(context, await parseCatalog(root, root, 'folder'), 'full', 'claude-cli');
    assert.deepEqual([report.outcome, report.changed, report.version], ['updated', true, '1.0.0'], report.message);
    assert.equal(report.message, 'Updated to 1.0.0.');
    assert.deepEqual(report.notes, ['It was off in Claude Code, and the update turned it on. It couldn’t be turned off again: turn it off in Claude Code. Plugin could not be disabled.']);
  } finally { await box.cleanup(); }
});

/** Every file under `folder` with its bytes, to show nothing in it changed. */
async function files(folder: string): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const name of await readdir(folder, { recursive: true, withFileTypes: true })) if (name.isFile()) out[join(name.parentPath, name.name)] = await readFile(join(name.parentPath, name.name), 'utf8');
  return out;
}

/** A Codex home with ck-test-market's `full` installed (skills `one` and `second`, the latter in folder two). */
async function codexHome() {
  const box = await sandbox();
  const copy = join(box.home, '.codex/plugins/cache/ck-test-market/full/1.0.0');
  await put(join(copy, 'skills/one/SKILL.md'), '---\nname: one\ndescription: One.\n---\nB\n');
  await put(join(copy, 'skills/two/SKILL.md'), '---\nname: second\ndescription: Named apart from its folder.\n---\nB\n');
  const original = '# mine\nmodel = "o3"\n\n[marketplaces.ck-test-market]\nsource = "/m"\n\n[plugins."full@ck-test-market"]\nenabled = true\n\n[[skills.config]]\npath = "/elsewhere/SKILL.md"\nenabled = false\n';
  const config = join(box.home, '.codex/config.toml');
  await put(config, original);
  const switchTo = (skill: string, on: boolean) => setSkill(box.context, 'ck-test-market', 'full', skill, 'codex-cli', on, '/m');
  return { box, copy, original, config, switchTo };
}

test('Codex turns one skill of a plugin off by name in config.toml and back on to the same bytes, and the plugin’s files never change', async () => {
  const { box, copy, original, config, switchTo } = await codexHome();
  try {
    const plugin = await files(copy);
    const off = await switchTo('one', false);
    assert.deepEqual([off.outcome, off.changed], ['skill-off', true], off.message);
    assert.equal(await readFile(config, 'utf8'), `${original}\n[[skills.config]]\nname = "full:one"\nenabled = false\n`);
    assert.deepEqual(await installState(box.context, 'codex-cli', 'ck-test-market', 'full'), { state: 'installed', path: copy, version: '1.0.0', skills: ['one', 'second'], skillsOff: [{ skill: 'one' }] });
    assert.equal((await switchTo('one', false)).changed, undefined, 'already off is not a change');
    const on = await switchTo('one', true);
    assert.deepEqual([on.outcome, on.changed], ['skill-on', true], on.message);
    assert.equal(await readFile(config, 'utf8'), original);
    // The same round trip through codexConfigSwitched (fresh process, nothing in codexWrites).
    await switchTo('one', false);
    switchCodexFresh(box.context, 'one', true);
    assert.equal(await readFile(config, 'utf8'), original);
    // Codex's own /skills toggle writes the SKILL.md path of one version's copy; it counts, and turning on removes every bare block that picks the skill.
    await writeFile(config, `${original}\n[[skills.config]]\npath = ${tomlValue(join(copy, 'skills/two/SKILL.md'))}\nenabled = false\n\n[[skills.config]]\nname = "full:second"\nenabled = false\n`);
    assert.deepEqual((await installState(box.context, 'codex-cli', 'ck-test-market', 'full') as { skillsOff?: unknown }).skillsOff, [{ skill: 'second' }]);
    assert.equal((await switchTo('second', true)).outcome, 'skill-on');
    assert.equal(await readFile(config, 'utf8'), original);
    // Last-first Undo restores exact bytes through codexWrites, even for a bare block (full:second) with no final newline.
    const kept = `${original}\n[[skills.config]]\nname = "full:one" # keep on\nenabled = true\n\n[[skills.config]]\nname = "full:second"\nenabled = true`;
    await writeFile(config, kept);
    for (const skill of ['one', 'second']) await switchTo(skill, false);
    for (const skill of ['second', 'one']) await switchTo(skill, true);
    assert.equal(await readFile(config, 'utf8'), kept);
    assert.deepEqual(await files(copy), plugin);
  } finally { await box.cleanup(); }
});

/** Runs setSkill in a fresh Node process so `codexWrites` is empty, as after a restart. */
function switchCodexFresh(context: PluginContext, skill: string, on: boolean): void {
  const pluginsUrl = new URL('../src/plugins.ts', import.meta.url).href;
  const script = `import { setSkill } from ${JSON.stringify(pluginsUrl)};
const r = await setSkill(${JSON.stringify(context)}, 'ck-test-market', 'full', ${JSON.stringify(skill)}, 'codex-cli', ${JSON.stringify(on)}, '/m');
if (r.outcome !== ${JSON.stringify(on ? 'skill-on' : 'skill-off')} || !r.changed) { console.error(r); process.exit(1); }`;
  execFileSync(process.execPath, ['--input-type=module', '-e', script], { stdio: 'pipe' });
}

test('Codex: turning two skills off and on in another order than last-first keeps his commented blocks byte for byte', async () => {
  const { box, original, config, switchTo } = await codexHome();
  try {
    const before = `${original}\n[[skills.config]]\nname = "full:one" # keep on\nenabled = true\n\n[[skills.config]]\nname = "full:second"\nenabled = true # also keep`;
    await writeFile(config, before);
    await switchTo('one', false);
    await switchTo('second', false);
    assert.equal(await readFile(config, 'utf8'), `${original}\n[[skills.config]]\nname = "full:one" # keep on\nenabled = false\n\n[[skills.config]]\nname = "full:second"\nenabled = false # also keep`);
    assert.deepEqual((await installState(box.context, 'codex-cli', 'ck-test-market', 'full') as { skillsOff?: unknown }).skillsOff, [{ skill: 'one' }, { skill: 'second' }]);
    await switchTo('one', true);
    await switchTo('second', true);
    assert.equal(await readFile(config, 'utf8'), before);
    assert.deepEqual((await installState(box.context, 'codex-cli', 'ck-test-market', 'full') as { skillsOff?: unknown }).skillsOff, []);
  } finally { await box.cleanup(); }
});

test('Codex: turning skills back on in a fresh process keeps his commented blocks byte for byte, and drops a bare one', async () => {
  const { box, original, config, switchTo } = await codexHome();
  try {
    const before = `${original}\n[[skills.config]]\nname = "full:one" # keep on\nenabled = true\n\n[[skills.config]]\nname = "full:second"\nenabled = true # also keep`;
    await writeFile(config, before);
    await switchTo('one', false);
    await switchTo('second', false);
    switchCodexFresh(box.context, 'one', true);
    switchCodexFresh(box.context, 'second', true);
    assert.equal(await readFile(config, 'utf8'), before);
    assert.deepEqual((await installState(box.context, 'codex-cli', 'ck-test-market', 'full') as { skillsOff?: unknown }).skillsOff, []);
    // Accepted limit: a bare block of his (`name` and `enabled = true`, no comment) turned off and then on in another session is taken out.
    const bare = `${original}\n[[skills.config]]\nname = "full:one"\nenabled = true`;
    await writeFile(config, bare);
    await switchTo('one', false);
    assert.equal(await readFile(config, 'utf8'), `${original}\n[[skills.config]]\nname = "full:one"\nenabled = false`);
    switchCodexFresh(box.context, 'one', true);
    assert.equal(await readFile(config, 'utf8'), original);
    assert.deepEqual((await installState(box.context, 'codex-cli', 'ck-test-market', 'full') as { skillsOff?: unknown }).skillsOff, []);
  } finally { await box.cleanup(); }
});

test('Codex: a path block gets a name-only rule on Off; after an update, fresh On drops the name rule and leaves old-version blocks untouched', async () => {
  const { box, copy, original, config, switchTo } = await codexHome();
  try {
    const older090 = join(box.home, '.codex/plugins/cache/ck-test-market/full/0.9.0');
    await put(join(older090, 'skills/two/SKILL.md'), '---\nname: second\ndescription: Old.\n---\nB\n');
    const dormant090 = `\n[[skills.config]]\n# dormant 0.9.0 block\npath = ${tomlValue(join(older090, 'skills/two/SKILL.md'))}\nenabled = false\n`;
    const alreadyFalseV1 = `\n[[skills.config]]\n# already false before any click\npath = ${tomlValue(join(copy, 'skills/two/SKILL.md'))}\nenabled = false\n`;
    const otherSkillV1 = `\n[[skills.config]]\n# another skill\npath = ${tomlValue(join(copy, 'skills/one/SKILL.md'))}\nenabled = false\n`;
    const hisV1Path = (enabled: boolean) => `\n[[skills.config]]\n# keep path block\npath = ${tomlValue(join(copy, 'skills/two/SKILL.md'))}\nenabled = ${enabled}\n`;
    const start = `${original}${dormant090}${alreadyFalseV1}${otherSkillV1}${hisV1Path(true)}`;
    await writeFile(config, start);
    await switchTo('second', false);
    const afterOff = `${original}${dormant090}${alreadyFalseV1}${otherSkillV1}${hisV1Path(false)}\n[[skills.config]]\nname = "full:second"\nenabled = false\n`;
    assert.equal(await readFile(config, 'utf8'), afterOff);
    assert.deepEqual((await installState(box.context, 'codex-cli', 'ck-test-market', 'full') as { skillsOff?: unknown }).skillsOff, [{ skill: 'second' }, { skill: 'one' }]);
    // A plugin update to 2.0.0 leaves the 1.0.0 path pointing at an older copy; the appended name-only rule keeps the skill off.
    const newer = join(box.home, '.codex/plugins/cache/ck-test-market/full/2.0.0');
    await put(join(newer, 'skills/one/SKILL.md'), '---\nname: one\ndescription: One.\n---\nB\n');
    await put(join(newer, 'skills/two/SKILL.md'), '---\nname: second\ndescription: Named apart from its folder.\n---\nB\n');
    assert.deepEqual(await installState(box.context, 'codex-cli', 'ck-test-market', 'full'), { state: 'installed', path: newer, version: '2.0.0', skills: ['one', 'second'], skillsOff: [{ skill: 'second' }] });
    // Accepted limit: after Off, an update and a restart, On drops the app's name rule and leaves every old-version block as it stands.
    switchCodexFresh(box.context, 'second', true);
    assert.equal(await readFile(config, 'utf8'), `${original}${dormant090}${alreadyFalseV1}${otherSkillV1}${hisV1Path(false)}`);
    assert.deepEqual((await installState(box.context, 'codex-cli', 'ck-test-market', 'full') as { skillsOff?: unknown }).skillsOff, []);
    // Without an update (1.0.0 still active), fresh On sets his active path block true in place and drops the bare name block: byte for byte.
    await rm(newer, { recursive: true });
    await rm(older090, { recursive: true });
    const byPath = `${original}${hisV1Path(true)}`;
    await writeFile(config, byPath);
    await switchTo('second', false);
    switchCodexFresh(box.context, 'second', true);
    assert.equal(await readFile(config, 'utf8'), byPath);
    // Another key besides name/path and enabled keeps the block (name-only, so no extra block is appended on Off).
    const extraKey = `${original}\n[[skills.config]]\nname = "full:one"\nnote = "team default"\nenabled = true\n`;
    await writeFile(config, extraKey);
    await switchTo('one', false);
    assert.equal(await readFile(config, 'utf8'), `${original}\n[[skills.config]]\nname = "full:one"\nnote = "team default"\nenabled = false\n`);
    switchCodexFresh(box.context, 'one', true);
    assert.equal(await readFile(config, 'utf8'), extraKey);
    // A commented block with no enabled line gains `enabled = false` in place on Off, then `enabled = true` on On.
    const noEnabled = `${original}\n[[skills.config]] # keep\nname = "full:one"\n`;
    await writeFile(config, noEnabled);
    await switchTo('one', false);
    assert.equal(await readFile(config, 'utf8'), `${noEnabled}enabled = false\n`);
    switchCodexFresh(box.context, 'one', true);
    assert.equal(await readFile(config, 'utf8'), `${noEnabled}enabled = true\n`);
    // A `#` inside a quoted path string is not a comment: a bare path block with `#` in its path is still taken out on On.
    await put(join(copy, 'skills/hash#dir/SKILL.md'), '---\nname: hashed\ndescription: Hash.\n---\nB\n');
    const hashed = `${original}\n[[skills.config]]\npath = ${tomlValue(join(copy, 'skills/hash#dir/SKILL.md'))}\nenabled = false\n`;
    await writeFile(config, hashed);
    assert.equal((await switchTo('hashed', true)).outcome, 'skill-on');
    assert.equal(await readFile(config, 'utf8'), original);
  } finally { await box.cleanup(); }
});

test('Codex: when an update removes 1.0.0 and reuses another skill’s folder, fresh On never changes another skill’s old-version rule', async () => {
  const { box, copy, original, config, switchTo } = await codexHome();
  try {
    const oneOff = `\n[[skills.config]]\n# keep one off\npath = ${tomlValue(join(copy, 'skills/one/SKILL.md'))}\nenabled = false\n`;
    const twoBlock = (enabled: boolean) => `\n[[skills.config]]\n# keep second\npath = ${tomlValue(join(copy, 'skills/two/SKILL.md'))}\nenabled = ${enabled}\n`;
    await writeFile(config, `${original}${oneOff}${twoBlock(true)}`);
    await switchTo('second', false);
    // Update removes 1.0.0 and installs 2.0.0 with `second` placed in the `skills/one` folder that belonged to `one` in 1.0.0.
    await rm(copy, { recursive: true });
    const newer = join(box.home, '.codex/plugins/cache/ck-test-market/full/2.0.0');
    await put(join(newer, 'skills/one/SKILL.md'), '---\nname: second\ndescription: Reused folder.\n---\nB\n');
    await put(join(newer, 'skills/two/SKILL.md'), '---\nname: one\ndescription: Swapped.\n---\nB\n');
    switchCodexFresh(box.context, 'second', true);
    assert.equal(await readFile(config, 'utf8'), `${original}${oneOff}${twoBlock(false)}`);
    assert.deepEqual((await installState(box.context, 'codex-cli', 'ck-test-market', 'full') as { skillsOff?: unknown }).skillsOff, []);
  } finally { await box.cleanup(); }
});

test('Codex: a block carrying both name and path is ignored as Codex ignores it; Off leaves it byte for byte and adds a name rule', async () => {
  const { box, copy, original, config, switchTo } = await codexHome();
  try {
    for (const [nameVal, pathVal, enabled] of [
      ['full:one', join(copy, 'skills/one/SKILL.md'), false],
      ['full:one', join(copy, 'skills/two/SKILL.md'), false],
      ['full:one', join(copy, 'skills/one/SKILL.md'), true],
      ['full:one', join(copy, 'skills/two/SKILL.md'), true],
      ['full:one', '', false],
      ['', join(copy, 'skills/one/SKILL.md'), false],
    ] as const) {
      const bothKeys = `${original}\n[[skills.config]]\nname = ${tomlValue(nameVal)}\npath = ${tomlValue(pathVal)}\nenabled = ${enabled}\n`;
      await writeFile(config, bothKeys);
      assert.deepEqual((await installState(box.context, 'codex-cli', 'ck-test-market', 'full') as { skillsOff?: unknown }).skillsOff, []);
      const off = await switchTo('one', false);
      assert.deepEqual([off.outcome, off.changed], ['skill-off', true], off.message);
      assert.equal(await readFile(config, 'utf8'), `${bothKeys}\n[[skills.config]]\nname = "full:one"\nenabled = false\n`);
      assert.deepEqual((await installState(box.context, 'codex-cli', 'ck-test-market', 'full') as { skillsOff?: unknown }).skillsOff, [{ skill: 'one' }]);
      await switchTo('one', true);
      assert.equal(await readFile(config, 'utf8'), bothKeys);
      await switchTo('one', false);
      switchCodexFresh(box.context, 'one', true);
      assert.equal(await readFile(config, 'utf8'), bothKeys);
    }
    // A both-keys enabled=true block after a real name=false block does not override it (Codex ignores the both-keys block).
    const realOffThenBoth = `${original}\n[[skills.config]]\nname = "full:one"\nenabled = false\n\n[[skills.config]]\nname = "full:one"\npath = ${tomlValue(join(copy, 'skills/one/SKILL.md'))}\nenabled = true\n`;
    await writeFile(config, realOffThenBoth);
    assert.deepEqual((await installState(box.context, 'codex-cli', 'ck-test-market', 'full') as { skillsOff?: unknown }).skillsOff, [{ skill: 'one' }]);
    switchCodexFresh(box.context, 'one', true);
    assert.equal(await readFile(config, 'utf8'), `${original}\n[[skills.config]]\nname = "full:one"\npath = ${tomlValue(join(copy, 'skills/one/SKILL.md'))}\nenabled = true\n`);
  } finally { await box.cleanup(); }
});

test('Codex: same-session On then Off ends with a name-only rule saying false, while a file with only the app’s own block still returns byte for byte', async () => {
  const { box, copy, original, config, switchTo } = await codexHome();
  try {
    // Path-only enabled = false (Codex's /skills toggle form): On then Off in one process leaves a name-only rule so a 2.0.0 update stays off.
    const pathOff = `${original}\n[[skills.config]]\npath = ${tomlValue(join(copy, 'skills/two/SKILL.md'))}\nenabled = false\n`;
    await writeFile(config, pathOff);
    assert.deepEqual((await installState(box.context, 'codex-cli', 'ck-test-market', 'full') as { skillsOff?: unknown }).skillsOff, [{ skill: 'second' }]);
    await switchTo('second', true);
    assert.equal(await readFile(config, 'utf8'), original);
    await switchTo('second', false);
    assert.equal(await readFile(config, 'utf8'), `${original}\n[[skills.config]]\nname = "full:second"\nenabled = false\n`);
    const newer = join(box.home, '.codex/plugins/cache/ck-test-market/full/2.0.0');
    await put(join(newer, 'skills/one/SKILL.md'), '---\nname: one\ndescription: One.\n---\nB\n');
    await put(join(newer, 'skills/two/SKILL.md'), '---\nname: second\ndescription: Named apart from its folder.\n---\nB\n');
    assert.deepEqual(await installState(box.context, 'codex-cli', 'ck-test-market', 'full'), { state: 'installed', path: newer, version: '2.0.0', skills: ['one', 'second'], skillsOff: [{ skill: 'second' }] });
    await rm(newer, { recursive: true });
    // Commented path-only enabled = false: On edits it to true; same-session Off edits it back to false AND appends a name-only rule.
    const commentedPathOff = `${original}\n[[skills.config]]\n# keep\npath = ${tomlValue(join(copy, 'skills/two/SKILL.md'))}\nenabled = false\n`;
    await writeFile(config, commentedPathOff);
    await switchTo('second', true);
    await switchTo('second', false);
    assert.equal(await readFile(config, 'utf8'), `${commentedPathOff}\n[[skills.config]]\nname = "full:second"\nenabled = false\n`);
    // A name=true rule before a path=false rule: On then Off in one process must not restore name=true + path=false (which would turn on after an update).
    const nameTruePathFalse = `${original}\n[[skills.config]]\n# keep name\nname = "full:second"\nenabled = true\n\n[[skills.config]]\npath = ${tomlValue(join(copy, 'skills/two/SKILL.md'))}\nenabled = false\n`;
    await writeFile(config, nameTruePathFalse);
    await switchTo('second', true);
    await switchTo('second', false);
    assert.equal(await readFile(config, 'utf8'), `${original}\n[[skills.config]]\n# keep name\nname = "full:second"\nenabled = false\n`);
    // A file with only the app's own block: On then Off then On in one process stays byte for byte at every step (also without a final newline).
    for (const appOff of [`${original}\n[[skills.config]]\nname = "full:one"\nenabled = false\n`, `${original}\n[[skills.config]]\nname = "full:one"\nenabled = false`]) {
      await writeFile(config, appOff);
      await switchTo('one', true);
      const afterOn = await readFile(config, 'utf8');
      assert.equal(afterOn, original);
      await switchTo('one', false);
      assert.equal(await readFile(config, 'utf8'), appOff);
      await switchTo('one', true);
      assert.equal(await readFile(config, 'utf8'), afterOn);
    }
  } finally { await box.cleanup(); }
});

test('Codex: comments directly above or after a block, or a sub-table of it, count as his and keep the block in place', async () => {
  const { box, original, config, switchTo } = await codexHome();
  try {
    // Comment directly above a bare block's header: Off -> fresh On, and Off -> unrelated editor save -> On, both keep his block.
    const above = `${original}\n# Pin this skill.\n[[skills.config]]\nname = "full:one"\nenabled = true\n\n[[skills.config]]\nname = "full:second"\nenabled = true\n`;
    await writeFile(config, above);
    await switchTo('one', false);
    switchCodexFresh(box.context, 'one', true);
    assert.equal(await readFile(config, 'utf8'), above);
    await switchTo('one', false);
    await writeFile(config, `# edited externally\n${await readFile(config, 'utf8')}`);
    await switchTo('one', true);
    assert.equal(await readFile(config, 'utf8'), `# edited externally\n${above}`);
    // Comment separated by a blank line above the header does NOT touch the bare block: fresh On still removes it.
    const spacedAbove = `${original}\n# section note\n\n[[skills.config]]\nname = "full:one"\nenabled = false\n`;
    await writeFile(config, spacedAbove);
    switchCodexFresh(box.context, 'one', true);
    assert.equal(await readFile(config, 'utf8'), `${original}\n# section note\n`);
    // Trailing comment line directly after the last entry at EOF: Off -> fresh On keeps the block byte for byte.
    const trailing = `${original}\n[[skills.config]]\nname = "full:one"\nenabled = true\n# Pin PDF reader.\n`;
    await writeFile(config, trailing);
    await switchTo('one', false);
    switchCodexFresh(box.context, 'one', true);
    assert.equal(await readFile(config, 'utf8'), trailing);
    // A blank line before `# about second` separates it from the bare block above (dropped), while `# about second` is directly above the second block (kept as his).
    const nextWithBlank = `${original}\n[[skills.config]]\nname = "full:one"\nenabled = false\n\n# about second\n[[skills.config]]\nname = "full:second"\nenabled = false\n`;
    await writeFile(config, nextWithBlank);
    switchCodexFresh(box.context, 'one', true);
    assert.equal(await readFile(config, 'utf8'), `${original}\n# about second\n[[skills.config]]\nname = "full:second"\nenabled = false\n`);
    switchCodexFresh(box.context, 'second', true);
    assert.equal(await readFile(config, 'utf8'), `${original}\n# about second\n[[skills.config]]\nname = "full:second"\nenabled = true\n`);
    // Without a blank line before `# about second`, the comment touches the block above it too, so that block is kept in place (taken on purpose).
    const nextTouching = `${original}\n[[skills.config]]\nname = "full:one"\nenabled = false\n# about second\n[[skills.config]]\nname = "full:second"\nenabled = false\n`;
    await writeFile(config, nextTouching);
    switchCodexFresh(box.context, 'one', true);
    assert.equal(await readFile(config, 'utf8'), `${original}\n[[skills.config]]\nname = "full:one"\nenabled = true\n# about second\n[[skills.config]]\nname = "full:second"\nenabled = false\n`);
    // A sub-table of a `[[skills.config]]` element keeps its parent block in place (never stranding the sub-table or attaching it to the block before).
    const twoWithSubtable = `${original}\n[[skills.config]]\nname = "full:one"\nenabled = false\n\n[[skills.config]]\nname = "full:second"\nenabled = false\n[skills.config.notes]\nreason = "keep the annotation"\n`;
    await writeFile(config, twoWithSubtable);
    switchCodexFresh(box.context, 'second', true);
    assert.equal(await readFile(config, 'utf8'), `${original}\n[[skills.config]]\nname = "full:one"\nenabled = false\n\n[[skills.config]]\nname = "full:second"\nenabled = true\n[skills.config.notes]\nreason = "keep the annotation"\n`);
    // Meanwhile the bare first block (no sub-table of its own) is still dropped cleanly.
    switchCodexFresh(box.context, 'one', true);
    assert.equal(await readFile(config, 'utf8'), `${original}\n[[skills.config]]\nname = "full:second"\nenabled = true\n[skills.config.notes]\nreason = "keep the annotation"\n`);
  } finally { await box.cleanup(); }
});

test('Codex: two blocks picking one skill (his commented block and a bare one): Off edits his in place, On removes only the bare one', async () => {
  const { box, original, config, switchTo } = await codexHome();
  try {
    // Bare `enabled = false` first, his commented `enabled = true` second: Codex starts with the skill on (last block wins).
    const before = `${original}\n[[skills.config]]\nname = "full:one"\nenabled = false\n\n[[skills.config]]\nname = "full:one" # keep on\nenabled = true\n`;
    await writeFile(config, before);
    assert.deepEqual((await installState(box.context, 'codex-cli', 'ck-test-market', 'full') as { skillsOff?: unknown }).skillsOff, []);
    await switchTo('one', false);
    assert.equal(await readFile(config, 'utf8'), `${original}\n[[skills.config]]\nname = "full:one"\nenabled = false\n\n[[skills.config]]\nname = "full:one" # keep on\nenabled = false\n`);
    assert.deepEqual((await installState(box.context, 'codex-cli', 'ck-test-market', 'full') as { skillsOff?: unknown }).skillsOff, [{ skill: 'one' }]);
    switchCodexFresh(box.context, 'one', true);
    assert.equal(await readFile(config, 'utf8'), `${original}\n[[skills.config]]\nname = "full:one" # keep on\nenabled = true\n`);
    assert.deepEqual((await installState(box.context, 'codex-cli', 'ck-test-market', 'full') as { skillsOff?: unknown }).skillsOff, []);
    // Reverse order: his commented block first, bare `enabled = false` second (starts off): On drops the bare one and keeps his.
    const reverse = `${original}\n[[skills.config]]\nname = "full:one" # keep on\nenabled = true\n\n[[skills.config]]\nname = "full:one"\nenabled = false\n`;
    await writeFile(config, reverse);
    assert.deepEqual((await installState(box.context, 'codex-cli', 'ck-test-market', 'full') as { skillsOff?: unknown }).skillsOff, [{ skill: 'one' }]);
    switchCodexFresh(box.context, 'one', true);
    assert.equal(await readFile(config, 'utf8'), `${original}\n[[skills.config]]\nname = "full:one" # keep on\nenabled = true\n`);
    assert.deepEqual((await installState(box.context, 'codex-cli', 'ck-test-market', 'full') as { skillsOff?: unknown }).skillsOff, []);
  } finally { await box.cleanup(); }
});

test('Codex switches the skills of the cached version it loads: local, else the highest', async () => {
  const { box, copy } = await codexHome();
  try {
    assert.deepEqual(['1.0.0', '1.0.0-beta.10', '0.9.0', '1.0.0-beta.2'].sort(compareVersions), ['0.9.0', '1.0.0-beta.2', '1.0.0-beta.10', '1.0.0']);
    for (const older of ['0.9.0', '1.0.0-beta.10', '1.0.0-beta.2']) await put(join(box.home, `.codex/plugins/cache/ck-test-market/full/${older}/skills/old/SKILL.md`), '---\nname: old\n---\nB\n');
    assert.equal((await installState(box.context, 'codex-cli', 'ck-test-market', 'full') as { path?: string }).path, copy);
    // A `local` copy wins over every version; once it is empty the plugin is Not known yet, never an older copy instead.
    const local = join(box.home, '.codex/plugins/cache/ck-test-market/full/local');
    await put(join(local, 'skills/one/SKILL.md'), '---\nname: one\n---\nB\n');
    assert.equal((await installState(box.context, 'codex-cli', 'ck-test-market', 'full') as { path?: string }).path, local);
    await rm(join(local, 'skills'), { recursive: true });
    assert.equal((await installState(box.context, 'codex-cli', 'ck-test-market', 'full')).state, 'not-known');
  } finally { await box.cleanup(); }
});

test('A Codex config.toml that writes skills.config as a value is left alone: a [[skills.config]] block would make it invalid', async () => {
  const { box, original, config, switchTo } = await codexHome();
  try {
    for (const inline of [`${original}\n[skills]\nconfig = [{ name = "full:two", enabled = false }]\n`, `skills.config = []\n${original}`, `skills = { config = [] }\n${original}`]) {
      await writeFile(config, inline);
      assert.equal((await installState(box.context, 'codex-cli', 'ck-test-market', 'full') as { switchesHeld?: string }).switchesHeld, INLINE_SKILLS_CONFIG, 'the page says so before anything is chosen');
      assert.equal((await switchTo('one', false)).outcome, 'failed');
      assert.equal(await readFile(config, 'utf8'), inline);
    }
  } finally { await box.cleanup(); }
});

test('Copilot CLI’s skill switch counts only once its settings say so; a bare name it turned off is held; Claude Code has no switch', { skip: noPosix }, async () => {
  const box = await sandbox();
  try {
    const copy = join(box.home, '.copilot/installed-plugins/ck-test-market/full');
    await put(join(copy, 'skills/one/SKILL.md'), '---\nname: one\n---\nB\n');
    await put(join(copy, 'skills/quiet/SKILL.md'), '---\nname: quiet\n---\nB\n');
    await put(join(box.home, '.copilot/config.json'), JSON.stringify({ installedPlugins: [{ name: 'full', marketplace: 'ck-test-market', cache_path: copy }] }));
    const settings = join(box.home, '.copilot/settings.json');
    // A stand-in for `copilot skill disable|enable NAME`: it records the name in disabledSkills, except "quiet", which it ignores
    // and still exits 0, as the real one does with a name it doesn't know.
    const bin = join(box.base, 'bin');
    await put(join(bin, 'copilot'), `#!/bin/sh
[ "$3" = "full:quiet" ] && exit 0
[ "$2" = "disable" ] && printf '{"disabledSkills":["%s"]}' "$3" > "$HOME/.copilot/settings.json"
[ "$2" = "enable" ] && printf '{"disabledSkills":[]}' > "$HOME/.copilot/settings.json"
exit 0
`);
    execFileSync('chmod', ['+x', join(bin, 'copilot')]);
    const context = { ...box.context, binaries: { 'copilot-cli': join(bin, 'copilot') } as PluginContext['binaries'] };
    const off = await setSkill(context, 'ck-test-market', 'full', 'one', 'copilot-cli', false, '/m');
    assert.deepEqual([off.outcome, off.changed, off.runs[0]?.command], ['skill-off', true, 'copilot skill disable full:one'], off.message);
    assert.deepEqual(await installState(context, 'copilot-cli', 'ck-test-market', 'full'), { state: 'installed', path: copy, skills: ['one', 'quiet'], skillsOff: [{ skill: 'one' }] });
    assert.equal((await setSkill(context, 'ck-test-market', 'full', 'one', 'copilot-cli', true, '/m')).outcome, 'skill-on');
    assert.equal((await setSkill(context, 'ck-test-market', 'full', 'quiet', 'copilot-cli', false, '/m')).outcome, 'failed', 'exit 0 with nothing recorded is not a change');
    assert.equal((await setSkill(context, 'ck-test-market', 'full', 'gone', 'copilot-cli', false, '/m')).message, 'The copy Copilot CLI has installed has no skill named “gone”.');
    // Skills its marketplace entry lists (outside skills/) are the copy's skills too, as the page reads them.
    await put(join(copy, 'custom/extra/SKILL.md'), '---\nname: extra\n---\nB\n');
    assert.deepEqual((await installState(context, 'copilot-cli', 'ck-test-market', 'full', { skills: ['./custom/extra'] }) as { skills?: string[] }).skills, ['extra']);
    // A bare name turns off every skill so named: one this plugin has is held; one it doesn't have isn't its at all.
    await writeFile(settings, JSON.stringify({ disabledSkills: ['one', 'my-notes'] }));
    assert.deepEqual((await installState(context, 'copilot-cli', 'ck-test-market', 'full') as { skillsOff?: { skill: string }[] }).skillsOff?.map(off => off.skill), ['one']);
    const held = await setSkill(context, 'ck-test-market', 'full', 'one', 'copilot-cli', true, '/m');
    assert.deepEqual([held.outcome, held.runs.length], ['failed', 0]);
    assert.match(held.message, /every skill named “one”/);
    const claude = await setSkill(context, 'ck-test-market', 'full', 'one', 'claude-cli', false, '/m');
    assert.deepEqual([claude.outcome, claude.message], ['failed', 'Claude Code has no switch for a single skill of a plugin: only the whole plugin turns off there.']);
  } finally { await box.cleanup(); }
});
