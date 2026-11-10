import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmod, mkdir, mkdtemp, readFile, realpath, rm, utimes, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { claudeDesktopData, coworkFolder } from '../src/cowork.ts';
import { createMarketplaces, type MarketplaceEngine, type MarketplaceHost } from '../src/marketplaces.ts';
import { outcomes } from '../src/pluginoutcomes.ts';
import * as engine from '../src/plugins.ts';
import { harnessIds } from '../src/harnesses.ts';
import type { DesktopApp, Snapshot } from '../src/types.ts';

const noPosix = process.platform === 'win32';
const put = async (path: string, text: string) => { await mkdir(dirname(path), { recursive: true }); await writeFile(path, text); };
const ACCOUNT = '4c22591e-4a8e-4f25-a463-2553c911ad10', ORG = 'a5a63f38-ccf7-4f64-a64b-fdf037fea7e5', OTHER = '11111111-2222-4333-8444-555555555555';

async function sandbox() {
  const base = await realpath(await mkdtemp(join(tmpdir(), 'ck-cowork-')));
  const home = join(base, 'home');
  const sessions = join(claudeDesktopData(home), 'local-agent-mode-sessions');
  await mkdir(home, { recursive: true });
  return { base, home, sessions, folder: join(sessions, ACCOUNT, ORG), cleanup: () => rm(base, { recursive: true, force: true }) };
}

async function marketplace(root: string) {
  await put(join(root, '.claude-plugin/marketplace.json'), JSON.stringify({ name: 'ck-test-market', plugins: [{ name: 'marker', source: './plugins/marker', version: '0.3.0' }] }));
  await put(join(root, 'plugins/marker/.claude-plugin/plugin.json'), JSON.stringify({ name: 'marker', version: '0.3.0' }));
  await put(join(root, 'plugins/marker/skills/ck-marker-skill/SKILL.md'), '---\nname: ck-marker-skill\ndescription: Marker.\n---\nReply ck-mk-1.\n');
  await put(join(root, 'plugins/marker/agents/helper.md'), 'Helper.\n');
}

/**
 * A stand-in for Claude Code that does what 2.1.321 did with `--cowork` on the Mac: the same records as ever, under
 * cowork_plugins/ and cowork_settings.json in CLAUDE_CONFIG_DIR. Without `--cowork` or that folder it fails, so a test
 * passes only when both were given.
 */
const claudeStandIn = `#!/bin/sh
set -e
echo "$CLAUDE_CONFIG_DIR|$*" >> "$HOME/calls.txt"
for last; do :; done
[ "$last" = "--cowork" ] && [ -n "$CLAUDE_CONFIG_DIR" ] || { echo "error: unknown option" >&2; exit 1; }
P="$CLAUDE_CONFIG_DIR/cowork_plugins"
mkdir -p "$P"
case "$2 $3" in
  "marketplace add") printf '{"ck-test-market":{"source":{"source":"directory","path":"%s"},"installLocation":"%s"}}' "$4" "$4" > "$P/known_marketplaces.json" ;;
  "install marker@ck-test-market") mkdir -p "$P/cache/ck-test-market/marker/0.3.0/skills/ck-marker-skill" && echo x > "$P/cache/ck-test-market/marker/0.3.0/skills/ck-marker-skill/SKILL.md"
    printf '{"version":2,"plugins":{"marker@ck-test-market":[{"scope":"user","installPath":"%s","version":"0.3.0"}]}}' "$P/cache/ck-test-market/marker/0.3.0" > "$P/installed_plugins.json"
    printf '{"enabledPlugins":{"marker@ck-test-market":true}}' > "$CLAUDE_CONFIG_DIR/cowork_settings.json" ;;
  "uninstall marker@ck-test-market") printf '{"version":2,"plugins":{}}' > "$P/installed_plugins.json" ;;
esac
`;

test('Cowork’s folder is found by the account’s folders in Claude desktop’s data; none means Cowork never ran here', async () => {
  const box = await sandbox();
  try {
    assert.equal(await coworkFolder(box.home), undefined, 'no Claude desktop data at all');
    // Claude desktop's other folders beside the accounts' are never taken for one.
    await mkdir(join(box.sessions, 'skills-plugin', ORG, ACCOUNT), { recursive: true });
    assert.equal(await coworkFolder(box.home), undefined);
    await mkdir(box.folder, { recursive: true });
    assert.equal(await coworkFolder(box.home), box.folder);
    // A second account, used later: the newest folder, unless Claude desktop names the account it was last signed in to.
    const second = join(box.sessions, OTHER, ORG);
    await mkdir(second, { recursive: true });
    await utimes(box.folder, new Date(1_000_000_000_000), new Date(1_000_000_000_000));
    assert.equal(await coworkFolder(box.home), second);
    await put(join(claudeDesktopData(box.home), 'config.json'), JSON.stringify({ lastKnownAccountUuid: ACCOUNT }));
    assert.equal(await coworkFolder(box.home), box.folder);
  } finally { await box.cleanup(); }
});

test('A plugin installs into Cowork through Claude Code with --cowork, in Cowork’s folder, and is read back from Cowork’s own records', { skip: noPosix }, async () => {
  const box = await sandbox();
  try {
    const root = join(box.base, 'market');
    await marketplace(root);
    await mkdir(box.folder, { recursive: true });
    const claude = join(box.base, 'bin/claude');
    await put(claude, claudeStandIn);
    await chmod(claude, 0o755);
    const context: engine.PluginContext = { home: box.home, dataDir: join(box.base, 'data'), binaries: { 'claude-cowork': claude }, overrides: { 'claude-cowork': box.folder }, timeoutMs: 20_000 };
    const catalog = await engine.parseCatalog(root, root, 'folder');

    const installed = await engine.install(context, catalog, 'marker', 'claude-cowork');
    assert.deepEqual([installed.outcome, installed.changed], ['installed', true], installed.message);
    assert.match(installed.message, /Start a new Cowork task in Claude desktop/);
    assert.deepEqual(installed.runs.map(run => run.command), [`claude plugin marketplace add ${root} --cowork`, 'claude plugin install marker@ck-test-market --scope user --cowork']);
    assert.deepEqual((await readFile(join(box.home, 'calls.txt'), 'utf8')).trim().split('\n').map(line => line.split('|')[0]), [box.folder, box.folder], 'each ran with Cowork’s folder as CLAUDE_CONFIG_DIR');
    assert.ok(installed.runs[1]!.changed.some(change => change.path === join(box.folder, 'cowork_plugins/installed_plugins.json') && change.before === null && change.after), 'the bytes before and after are kept');

    // The copy Cowork is handed is the one its record names, never the marketplace folder itself (unlike Claude Code).
    const state = await engine.installState(context, 'claude-cowork', 'ck-test-market', 'marker');
    assert.deepEqual(state, { state: 'installed', path: join(box.folder, 'cowork_plugins/cache/ck-test-market/marker/0.3.0'), version: '0.3.0' });
    assert.deepEqual(await engine.registeredMarketplaces(context, 'claude-cowork'), [{ name: 'ck-test-market', source: root }]);
    assert.deepEqual((await engine.installedPlugins(context, 'claude-cowork')).map(found => [found.plugin, found.marketplace, found.state.state, found.off]), [['marker', 'ck-test-market', 'installed', false]]);
    // Claude Code's own records in the same home are another matter entirely.
    assert.equal((await engine.installState(context, 'claude-cli', 'ck-test-market', 'marker')).state, 'not-installed');

    const again = await engine.install(context, catalog, 'marker', 'claude-cowork');
    assert.deepEqual([again.outcome, again.changed, again.runs.length], ['installed', undefined, 0], 'already installed is not a change');
    const removed = await engine.uninstall(context, 'ck-test-market', 'marker', 'claude-cowork', root);
    assert.deepEqual([removed.outcome, removed.changed], ['uninstalled', true], removed.message);
    assert.deepEqual(removed.runs.map(run => run.command), ['claude plugin uninstall marker@ck-test-market --scope user --cowork']);
  } finally { await box.cleanup(); }
});

test('Cowork is left alone when it holds another marketplace of the same name, and nothing runs without its folder or Claude Code', { skip: noPosix }, async () => {
  const box = await sandbox();
  try {
    const root = join(box.base, 'market');
    await marketplace(root);
    const catalog = await engine.parseCatalog(root, root, 'folder');
    const base = { home: box.home, dataDir: join(box.base, 'data'), timeoutMs: 20_000 };
    const noBinary = await engine.install({ ...base, binaries: {}, overrides: { 'claude-cowork': box.folder } }, catalog, 'marker', 'claude-cowork');
    assert.equal(noBinary.outcome, 'failed');
    assert.match(noBinary.message, /Claude Code wasn’t found here/);
    const noFolder = await engine.install({ ...base, binaries: { 'claude-cowork': '/bin/true' } }, catalog, 'marker', 'claude-cowork');
    assert.equal(noFolder.outcome, 'failed');
    assert.match(noFolder.message, /Cowork’s folder in Claude desktop wasn’t found/);
    await put(join(box.folder, 'cowork_settings.json'), JSON.stringify({ extraKnownMarketplaces: { 'ck-test-market': { source: { source: 'git', url: 'https://example.com/someone-else.git' } } } }));
    const held = await engine.install({ ...base, binaries: { 'claude-cowork': '/bin/true' }, overrides: { 'claude-cowork': box.folder } }, catalog, 'marker', 'claude-cowork');
    assert.equal(held.outcome, 'held');
    assert.match(held.message, /Cowork has a different marketplace named/);
    assert.deepEqual(held.runs, []);
  } finally { await box.cleanup(); }
});

test('Cowork is a column on the Plugins pages only where Claude desktop is here and Cowork has run; no other page gets it', async () => {
  const box = await sandbox();
  try {
    const root = join(box.base, 'market');
    await marketplace(root);
    const app: DesktopApp = { name: 'Claude desktop', version: '5.1231.0', carries: 'Code tab', carriedVersion: '2.1.321', binary: '/bin/true' };
    const claude = (more: Partial<Snapshot>): Snapshot => ({ harness: 'claude-cli', harnessName: 'Claude Code', surface: 'CLI', mode: 'actual', label: 'This Mac', root: join(box.home, '.claude'),
      detection: 'Installed', probe: { state: 'ok', version: '2.1.321', detail: '' }, discovery: 'empty', skills: [], issues: [], ...more });
    let snapshots: Snapshot[] = [claude({})];
    const host: MarketplaceHost = { home: () => ({ home: box.home }), read: async () => ({ tools: ['claude-cli', 'copilot-cli'], snapshots }), writeAccess: async () => ({ allowed: true }),
      dataDir: join(box.base, 'data'), pickFolder: async () => undefined, openExternal: async () => {} };
    const use: MarketplaceEngine = { findClis: async () => ({ binaries: { 'claude-cli': '/bin/true', 'claude-cowork': '/bin/true' }, apps: {} }), checkAccess: engine.checkAccess, readCatalog: engine.readCatalog,
      readRemotePlugin: async () => ({ problem: 'not in tests' }), install: engine.install, uninstall: engine.uninstall, update: engine.update, setSkill: engine.setSkill };
    const markets = createMarketplaces(host, use);
    await markets.add(root);
    // Claude Code's CLI alone: no Claude desktop, so no Cowork, whatever folders are left behind.
    await mkdir(box.folder, { recursive: true });
    assert.deepEqual((await markets.view()).tools, ['claude-cli', 'copilot-cli']);
    // Claude desktop here, and Cowork has run: it joins, right after Claude Code.
    snapshots = [claude({ app })];
    await put(join(box.folder, 'cowork_plugins/installed_plugins.json'), JSON.stringify({ version: 2, plugins: { 'marker@ck-test-market': [{ scope: 'user', installPath: join(box.folder, 'cowork_plugins/cache/ck-test-market/marker/0.3.0'), version: '0.3.0' }] } }));
    await put(join(box.folder, 'cowork_plugins/cache/ck-test-market/marker/0.3.0/skills/ck-marker-skill/SKILL.md'), '---\nname: ck-marker-skill\ndescription: Marker.\n---\nReply ck-mk-1.\n');
    const view = await markets.view();
    assert.deepEqual(view.tools, ['claude-cli', 'claude-cowork', 'copilot-cli']);
    assert.equal(view.clis['claude-cowork'], true);
    assert.equal(view.via?.['claude-cowork'], undefined, 'Claude desktop’s copy is Cowork’s own route, not a stand-in for a CLI');
    assert.deepEqual(view.marketplaces[0]!.states.marker?.['claude-cowork'], { state: 'installed', path: join(box.folder, 'cowork_plugins/cache/ck-test-market/marker/0.3.0'), version: '0.3.0' });
    assert.equal(view.marketplaces[0]!.states.marker?.['claude-cli']?.state, 'not-installed');
    // Claude desktop here but Cowork never used: nothing to install into, so no column.
    await rm(box.sessions, { recursive: true });
    assert.deepEqual((await markets.view()).tools, ['claude-cli', 'copilot-cli']);
    // The tools with folders of their own never include it.
    assert.equal((harnessIds as string[]).includes('claude-cowork'), false);
  } finally { await box.cleanup(); }
});

test('In Cowork a plugin’s skills are said to work; its other parts are said to be unconfirmed, never promised', () => {
  const said = outcomes('claude-cowork', { skills: 1, commands: 1, agents: 1, hooks: true, mcp: 1, mcpRootVariable: false, bin: false, skillNames: ['a'] });
  assert.deepEqual(said.map(outcome => [outcome.component, outcome.result]), [['Skills', 'works'], ['Commands', 'unknown'], ['Agents', 'unknown'], ['Hooks', 'unknown'], ['MCP servers', 'unknown']]);
});
