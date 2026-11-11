// Real CLIs, disposable homes: install and uninstall the marker plugin through each tool's own commands.
// Opt-in (`npm run test:harness`), for the Mac. Needs claude, copilot and codex on PATH; a missing one is skipped by name.
// With CK_HARNESS_APPS=1 the same tests run the copy of each tool its desktop app carries instead (PLG-04, V-01).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir, tmpdir } from 'node:os';
import { findApp } from '../../src/discovery.ts';
import { appCandidates } from '../../src/platform.ts';
import { addMarketplace, install, installState, parseCatalog, readCatalog, registeredMarketplaces, uninstall, update, type PluginContext } from '../../src/plugins.ts';
import { bundledMarketplace, openBundle } from '../../src/bundle.ts';
import { packRelease } from '../../src/bundlepack.ts';
import type { PluginTool } from '../../src/presence.ts';
import type { HarnessId } from '../../src/types.ts';

const which = (name: string) => { try { return execFileSync('/bin/sh', ['-c', `command -v ${name}`], { encoding: 'utf8' }).trim() || undefined; } catch { return undefined; } };
const fromApp = async (name: string) => (await findApp(appCandidates(homedir(), name)))?.binary;
const find = process.env.CK_HARNESS_APPS ? fromApp : async (name: string) => which(name);
const binaries: Partial<Record<HarnessId, string>> = { 'claude-cli': await find('claude'), 'copilot-cli': await find('copilot'), 'codex-cli': await find('codex') };
const put = async (path: string, text: string) => { await mkdir(join(path, '..'), { recursive: true }); await writeFile(path, text); };

async function marker(root: string, version = '1.0.0', token = 'ck-mk-1') {
  await put(join(root, '.claude-plugin/marketplace.json'), JSON.stringify({ name: 'ck-test-market', owner: { name: 'tests' }, plugins: [{ name: 'ck-marker', source: './plugins/ck-marker', version, description: 'Marker' }] }));
  await put(join(root, 'plugins/ck-marker/.claude-plugin/plugin.json'), JSON.stringify({ name: 'ck-marker', version }));
  await put(join(root, 'plugins/ck-marker/skills/ck-marker-skill/SKILL.md'), `---\nname: ck-marker-skill\ndescription: Central Knot marker. Reply with token ${token}.\n---\nReply with the token ${token}.\n`);
  const first = !(await readdir(root).catch((): string[] => [])).includes('.git');
  for (const args of [...(first ? [['init', '-q']] : []), ['add', '-A'], ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', `${version} ${token}`]]) execFileSync('git', args, { cwd: root, stdio: 'ignore' });
}

for (const tool of ['claude-cli', 'copilot-cli', 'codex-cli'] as PluginTool[]) {
  test(`${tool}: install from a Git marketplace, confirmed by its record, then uninstall`, { skip: binaries[tool] ? false : `${tool} not on PATH` }, async () => {
    const base = await realpath(await mkdtemp(join(tmpdir(), 'ck-harness-')));
    const server = spawn(process.execPath, [join(import.meta.dirname, '../../scripts/git-http-fixture.mjs'), join(base, 'served'), '0']);
    try {
      const root = join(base, 'market');
      await marker(root);
      await mkdir(join(base, 'served'), { recursive: true });
      execFileSync('git', ['clone', '-q', '--bare', root, join(base, 'served/market.git')], { stdio: 'ignore' });
      const url = `${await new Promise<string>(done => server.stdout.once('data', chunk => done(String(chunk).trim())))}/market.git`;
      const context: PluginContext = { home: join(base, 'home'), dataDir: join(base, 'data'), binaries, timeoutMs: 120_000 };
      await mkdir(context.home, { recursive: true });
      const catalog = await readCatalog(context, url);
      assert.equal(catalog.problem, undefined);
      const report = await install(context, catalog, 'ck-marker', tool);
      assert.equal(report.outcome, 'installed', JSON.stringify(report, null, 1));
      assert.ok(report.runs.some(run => run.changed.length > 0), 'the files it changed are disclosed');
      assert.ok((await readdir(join(context.dataDir, 'native'))).length > 0, 'and their prior bytes kept');
      const state = await installState(context, tool, 'ck-test-market', 'ck-marker');
      assert.ok(state.state === 'installed' && !state.live, JSON.stringify(state));
      const again = await install(context, catalog, 'ck-marker', tool);
      assert.equal(again.runs.length, 0, 'installing again runs nothing');
      const removed = await uninstall(context, 'ck-test-market', 'ck-marker', tool, catalog.source);
      assert.equal(removed.outcome, 'uninstalled', JSON.stringify(removed, null, 1));
      assert.equal((await installState(context, tool, 'ck-test-market', 'ck-marker')).state, 'not-installed');
    } finally { server.kill(); await rm(base, { recursive: true, force: true }); }
  });
}

test('copilot-cli: a local folder marketplace is loaded live, and says so', { skip: binaries['copilot-cli'] ? false : 'copilot not on PATH' }, async () => {
  const base = await realpath(await mkdtemp(join(tmpdir(), 'ck-harness-')));
  try {
    const root = join(base, 'market');
    await marker(root);
    const context: PluginContext = { home: join(base, 'home'), dataDir: join(base, 'data'), binaries, timeoutMs: 120_000 };
    await mkdir(context.home, { recursive: true });
    const report = await install(context, await parseCatalog(root, root, 'folder'), 'ck-marker', 'copilot-cli');
    assert.equal(report.outcome, 'installed', JSON.stringify(report, null, 1));
    assert.match(report.message, /loaded live/);
    assert.equal((await uninstall(context, 'ck-test-market', 'ck-marker', 'copilot-cli', root)).outcome, 'uninstalled');
  } finally { await rm(base, { recursive: true, force: true }); }
});

for (const tool of ['claude-cli', 'copilot-cli', 'codex-cli'] as PluginTool[]) {
  test(`${tool}: update from a Git marketplace that moved on, confirmed by its record`, { skip: binaries[tool] ? false : `${tool} not on PATH` }, async () => {
    const base = await realpath(await mkdtemp(join(tmpdir(), 'ck-harness-')));
    const server = spawn(process.execPath, [join(import.meta.dirname, '../../scripts/git-http-fixture.mjs'), join(base, 'served'), '0']);
    try {
      const root = join(base, 'market');
      await marker(root);
      await mkdir(join(base, 'served'), { recursive: true });
      const served = join(base, 'served/market.git');
      execFileSync('git', ['clone', '-q', '--bare', root, served], { stdio: 'ignore' });
      const url = `${await new Promise<string>(done => server.stdout.once('data', chunk => done(String(chunk).trim())))}/market.git`;
      const context: PluginContext = { home: join(base, 'home'), dataDir: join(base, 'data'), binaries, timeoutMs: 120_000 };
      await mkdir(context.home, { recursive: true });
      assert.equal((await install(context, await readCatalog(context, url), 'ck-marker', tool)).outcome, 'installed');
      // The marketplace moves on to 2.0.0; Central Knot reads it again, as Refresh does, and the tool's copy is behind.
      await marker(root, '2.0.0');
      execFileSync('git', ['push', '-q', served, 'HEAD:' + execFileSync('git', ['symbolic-ref', '--short', 'HEAD'], { cwd: served, encoding: 'utf8' }).trim()], { cwd: root, stdio: 'ignore' });
      const catalog = await readCatalog(context, url);
      assert.equal(catalog.plugins[0]?.version, '2.0.0');
      const report = await update(context, catalog, 'ck-marker', tool);
      assert.deepEqual([report.outcome, report.changed, report.version], ['updated', true, '2.0.0'], JSON.stringify(report, null, 1));
      const state = await installState(context, tool, 'ck-test-market', 'ck-marker');
      assert.ok(state.state === 'installed' && state.version === '2.0.0', JSON.stringify(state));
    } finally { server.kill(); await rm(base, { recursive: true, force: true }); }
  });
}

for (const tool of ['claude-cli', 'copilot-cli', 'codex-cli'] as PluginTool[]) {
  test(`${tool}: a copy whose content changed at the same version is updated, or reinstalled, until it matches`, { skip: binaries[tool] ? false : `${tool} not on PATH` }, async () => {
    const base = await realpath(await mkdtemp(join(tmpdir(), 'ck-harness-')));
    const server = spawn(process.execPath, [join(import.meta.dirname, '../../scripts/git-http-fixture.mjs'), join(base, 'served'), '0']);
    try {
      const root = join(base, 'market');
      await marker(root);
      await mkdir(join(base, 'served'), { recursive: true });
      const served = join(base, 'served/market.git');
      execFileSync('git', ['clone', '-q', '--bare', root, served], { stdio: 'ignore' });
      const url = `${await new Promise<string>(done => server.stdout.once('data', chunk => done(String(chunk).trim())))}/market.git`;
      const context: PluginContext = { home: join(base, 'home'), dataDir: join(base, 'data'), binaries, timeoutMs: 120_000 };
      await mkdir(context.home, { recursive: true });
      assert.equal((await install(context, await readCatalog(context, url), 'ck-marker', tool)).outcome, 'installed');
      // The skill's text changes; the version stays 1.0.0.
      await marker(root, '1.0.0', 'ck-mk-2');
      execFileSync('git', ['push', '-q', served, 'HEAD:' + execFileSync('git', ['symbolic-ref', '--short', 'HEAD'], { cwd: served, encoding: 'utf8' }).trim()], { cwd: root, stdio: 'ignore' });
      const catalog = await readCatalog(context, url);
      const skill = async () => { const state = await installState(context, tool, 'ck-test-market', 'ck-marker'); return state.state === 'installed' ? readFile(join(state.path, 'skills/ck-marker-skill/SKILL.md'), 'utf8').catch(() => '') : ''; };
      const differs = async () => !(await skill()).includes('ck-mk-2');
      assert.equal(await differs(), true, 'the installed copy still has the first text');
      const report = await update(context, catalog, 'ck-marker', tool, differs);
      console.log(tool, report.byContent, report.message, report.runs.map(run => `${run.command} => ${run.output.trim().slice(0, 200)}`));
      assert.deepEqual([report.outcome, report.changed], ['updated', true], JSON.stringify(report, null, 1));
      assert.equal(await differs(), false, 'and now it has the new text');
    } finally { server.kill(); await rm(base, { recursive: true, force: true }); }
  });
}

for (const tool of ['claude-cli', 'copilot-cli', 'codex-cli'] as PluginTool[]) {
  test(`${tool}: a bundled build's marketplace, unpacked in a data folder with a space in its path, is added to the tool's own list, then installs and uninstalls`, { skip: binaries[tool] ? false : `${tool} not on PATH` }, async () => {
    const base = await realpath(await mkdtemp(join(tmpdir(), 'ck-harness-')));
    try {
      // Packed as a build packs it, then opened as the app opens it, into a folder named as a Mac names one.
      const source = join(base, 'market');
      await marker(source);
      const packed = await packRelease({ source, out: join(base, 'carried'), work: join(base, 'work') });
      assert.ok('release' in packed, JSON.stringify(packed));
      await rm(source, { recursive: true, force: true });
      const dataDir = join(base, 'Application Support/acme-knot');
      const opened = await openBundle(dataDir, join(base, 'carried'));
      assert.equal(opened.problem, undefined);
      const folder = bundledMarketplace(dataDir);
      const context: PluginContext = { home: join(base, 'home'), dataDir: join(dataDir, 'plugins'), binaries, timeoutMs: 120_000 };
      await mkdir(context.home, { recursive: true });
      const catalog = await parseCatalog(folder, folder, 'folder');
      // Added to the tool's own list: nothing is installed, and the tool records the folder.
      const listed = await addMarketplace(context, catalog, tool);
      assert.equal(listed.outcome, 'added', JSON.stringify(listed, null, 1));
      assert.deepEqual((await registeredMarketplaces(context, tool)).map(entry => entry.name), ['ck-test-market']);
      assert.equal((await installState(context, tool, 'ck-test-market', 'ck-marker')).state, 'not-installed');
      assert.equal((await addMarketplace(context, catalog, tool)).outcome, 'there', 'a second add runs nothing');
      // Then its plugin installs by the tool's own command, with the source long gone, and uninstalls.
      const report = await install(context, catalog, 'ck-marker', tool);
      assert.equal(report.outcome, 'installed', JSON.stringify(report, null, 1));
      const state = await installState(context, tool, 'ck-test-market', 'ck-marker');
      assert.equal(state.state, 'installed', JSON.stringify(state));
      assert.equal((await uninstall(context, 'ck-test-market', 'ck-marker', tool, folder)).outcome, 'uninstalled');
    } finally { await rm(base, { recursive: true, force: true }); }
  });
}
